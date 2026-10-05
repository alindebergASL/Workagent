import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@/styles/globals.css";
import "@/styles/agent-first.css";
import "@/styles/foundations.css";
import "@/styles/products.css";
import { WorkspaceProvider } from "@/lib/client/workspace";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: { default: "Workagent", template: "%s · Workagent" },
  description: "Private workspace for finishing work from your own sources.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WorkspaceProvider>
          <Shell>{children}</Shell>
        </WorkspaceProvider>
      </body>
    </html>
  );
}
