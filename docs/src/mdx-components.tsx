import { APIPage } from "fumadocs-openapi/ui";
import defaultMdxComponents from "fumadocs-ui/mdx";
import {
	AnchorIcon,
	CodeIcon,
	FileTextIcon,
	LayersIcon,
	MonitorIcon,
	PlugIcon,
	PyramidIcon,
	RefreshCwIcon,
	ServerIcon,
	ShieldCheckIcon,
	ShieldIcon,
	StarIcon,
	UsersIcon,
	WrenchIcon,
} from "lucide-react";
import type { MDXComponents } from "mdx/types";
import { Mermaid } from "@/components/mdx/mermaid";
import { openapi } from "@/lib/openapi";
import OZWizard from "./components/oz-wizard";
import { APIGithubLinkHeader } from "./components/ui/api-reference/api-github-link-header";
import { APIItem } from "./components/ui/api-reference/api-item";
import { APIItemCompact } from "./components/ui/api-reference/api-item-compact";

// use this function to get MDX components, you will need it for rendering MDX
export function getMDXComponents(components?: MDXComponents): MDXComponents {
	return {
		...defaultMdxComponents,
		OZWizard,
		APIItemCompact,
		APIGithubLinkHeader,
		APIItem,
		FileTextIcon,
		UsersIcon,
		ShieldIcon,
		CodeIcon,
		MonitorIcon,
		PyramidIcon,
		StarIcon,
		LayersIcon,
		WrenchIcon,
		ServerIcon,
		AnchorIcon,
		ShieldCheckIcon,
		RefreshCwIcon,
		PlugIcon,
		Mermaid,
		APIPage: (props) => <APIPage {...openapi.getAPIPageProps(props)} />,
		...components,
	};
}
