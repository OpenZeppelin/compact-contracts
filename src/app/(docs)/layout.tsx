import type { ReactNode } from "react";
import { DocsLayoutClient } from "@/components/layout/docs-layout-client";

export default function Layout({ children }: { children: ReactNode }) {
	return <DocsLayoutClient>{children}</DocsLayoutClient>;
}
