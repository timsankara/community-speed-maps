// app/page.tsx
import SpeedCameraMap from "./components/SpeedCameraMap";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between">
      {/* A wrapper div ensuring the map takes full screen.
        You can add headers/navbars here later.
      */}
      <div className="w-full h-screen">
        <SpeedCameraMap />
      </div>
    </main>
  );
}
