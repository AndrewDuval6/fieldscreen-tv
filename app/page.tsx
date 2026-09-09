export default function Home() {
  return (
    <main className="h-dvh w-full overflow-hidden bg-[#07140f]">
      <iframe
        src="/preview/index.html"
        title="FieldScreen TV — interactive preview"
        allow="gamepad; fullscreen"
        className="h-full w-full border-0"
      />
    </main>
  );
}
