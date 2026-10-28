import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@/styles/globals.css";
import "@/styles/agent-first.css";
import "@/styles/foundations.css";
import "@/styles/products.css";
import "@/styles/phone.css";
import { WorkspaceProvider } from "@/lib/client/workspace";
import { Shell } from "@/components/Shell";
import { ScopeGate } from "@/components/ScopeGate";

export const metadata: Metadata = {
  title: { default: "Workagent", template: "%s · Workagent" },
  description: "Private workspace for finishing work from your own sources.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ScopeGate>
          <WorkspaceProvider>
            <Shell>{children}</Shell>
          </WorkspaceProvider>
        </ScopeGate>
      </body>
    </html>
  );
}
