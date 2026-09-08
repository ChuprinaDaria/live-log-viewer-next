import { DesktopConsole } from "@/components/DesktopConsole";

/**
 * The console pages on a desktop: secrets, MCP, machines, permissions, roles,
 * firms, channels.
 *
 * They exist on the phone already — the mobile shell switches in under 640 px
 * and puts them behind a tab bar. On a wide window none of them were reachable
 * at all, so a desktop operator saw the board and nothing else. This route is
 * the same screens with the destinations down the side.
 *
 * Nothing sensitive is rendered here, same as the root page: every screen
 * fetches through the API, which masks secret values before they leave the
 * console.
 */
export default function ConsolePage() {
  return (
    <main className="h-dvh w-full overflow-hidden bg-canvas">
      <DesktopConsole />
    </main>
  );
}
