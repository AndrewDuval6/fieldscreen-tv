#!/usr/bin/env python3
"""Build the separately licensed recording executable, or package its sources.

Linux x86-64 prerequisites: Python 3.12+, GCC, GNU make, binutils, xz.
The sources archive beside each release can be extracted and built offline:
    python3 build-recorder.py --source-dir . --output ./recorder
"""
import argparse
import hashlib
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

SOURCES = {
    'ffmpeg-8.1.2.tar.xz': ('https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz', '464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c'),
    'musl-1.2.5.tar.gz': ('https://musl.libc.org/releases/musl-1.2.5.tar.gz', 'a9a118bbe84d8764da0ea0d28b3ab3fae8477fc7e4085d90102b8596fc7c75e4'),
}
FLAGS = [
    '--cc=../musl/bin/musl-gcc', '--extra-ldflags=-static',
    '--disable-autodetect', '--disable-everything', '--disable-x86asm',
    '--disable-debug', '--disable-doc', '--disable-ffplay', '--disable-ffprobe',
    '--enable-ffmpeg', '--enable-protocol=file,pipe,http,tcp,crypto',
    '--enable-demuxer=hls,mpegts,mov,aac,mp3,matroska', '--enable-muxer=mp4',
    '--enable-parser=h264,hevc,aac,aac_latm,mpegaudio,ac3',
    '--enable-decoder=h264,hevc,aac,aac_latm,mp3,ac3,eac3,opus,vorbis,pcm_s16le',
    '--enable-encoder=aac', '--enable-filter=aresample,anull',
    '--enable-bsf=aac_adtstoasc,extract_extradata', '--enable-small',
    '--host-cc=gcc', '--host-ld=gcc',
]
NOTICE = '''FieldScreen TV recording engine

FFmpeg 8.1.2: Copyright (c) 2000-2026 the FFmpeg developers.
Distributed under GNU LGPL version 2.1 or later; see FFmpeg-LICENSE.txt.
This executable is built from unmodified upstream FFmpeg sources without
GPL or nonfree components. FFmpeg is a separate child process; it is not
linked into the FieldScreen application. https://ffmpeg.org/

musl 1.2.5: Copyright (c) 2005-2024 Rich Felker, et al.
Distributed under its MIT license; see musl-LICENSE.txt.
The static executable includes musl. https://musl.libc.org/

Complete corresponding source archives and the build script are provided
as FieldScreen-Recorder-Sources-8.1.2.tar.gz with the same GitHub release:
https://github.com/AndrewDuval6/fieldscreen-tv/releases
Extract that archive, then run:
  python3 build-recorder.py --source-dir . --output ./recorder
No download is needed when building from that archive.
You may rebuild and replace resources/recorder/ffmpeg in the portable
FieldScreen download. The recorder's license does not change the license
of the separate FieldScreen application.
'''


def run(args, cwd):
    subprocess.run(args, cwd=cwd, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path)
    parser.add_argument('--output', type=Path, default=Path('desktop/recorder'))
    parser.add_argument('--archive', type=Path, default=Path('release/FieldScreen-Recorder-Sources-8.1.2.tar.gz'))
    parser.add_argument('--sources-only', action='store_true')
    args = parser.parse_args()
    output = args.output.resolve()
    if not args.sources_only and (platform.system() != 'Linux' or platform.machine() != 'x86_64'):
        parser.error('This release build targets Linux x86-64.')
    with tempfile.TemporaryDirectory(prefix='fieldscreen-engine-') as temporary:
        build = Path(temporary)
        for name, (url, digest) in SOURCES.items():
            target = build / name
            if args.source_dir:
                shutil.copyfile(args.source_dir / name, target)
            else:
                with urllib.request.urlopen(url, timeout=90) as response, target.open('wb') as destination:
                    shutil.copyfileobj(response, destination)
            if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
                raise RuntimeError('Source checksum mismatch: ' + name)
            with tarfile.open(target) as source:
                source.extractall(build, filter='data')
        ff = build / 'ffmpeg-8.1.2'
        musl = build / 'musl-1.2.5'
        output.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ff / 'COPYING.LGPLv2.1', output / 'FFmpeg-LICENSE.txt')
        shutil.copyfile(musl / 'COPYRIGHT', output / 'musl-LICENSE.txt')
        (output / 'NOTICE.txt').write_text(NOTICE)
        args.archive.parent.mkdir(parents=True, exist_ok=True)
        with tarfile.open(args.archive, 'w:gz') as bundle:
            for name in SOURCES:
                bundle.add(build / name, arcname=name)
            bundle.add(__file__, arcname='build-recorder.py')
            for name in ['NOTICE.txt', 'FFmpeg-LICENSE.txt', 'musl-LICENSE.txt']:
                bundle.add(output / name, arcname=name)
        if args.sources_only:
            print('Verified complete sources, licenses, and build script packaged.')
            return
        jobs = '-j' + str(min(8, os.cpu_count() or 2))
        run(['./configure', '--prefix=' + str(build / 'musl'), '--disable-shared'], musl)
        run(['make', jobs], musl)
        run(['make', 'install'], musl)
        run(['./configure', *FLAGS], ff)
        run(['make', jobs], ff)
        shutil.copy2(ff / 'ffmpeg', output / 'ffmpeg')
        run([str(output / 'ffmpeg'), '-version'], output)
        print('Recording engine built; complete sources are in', args.archive)


if __name__ == '__main__':
    main()
