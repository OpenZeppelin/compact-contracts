import { loader } from "fumadocs-core/source";
import { transformerOpenAPI } from "fumadocs-openapi/server";
import { icons } from "lucide-react";
import { createElement } from "react";
import { docs } from "@/.source";

// See https://fumadocs.vercel.app/docs/headless/source-api for more info
export const source = loader({
	// it assigns a URL to your pages
	pageTree: {
		transformers: [transformerOpenAPI()],
	},
	baseUrl: "/",
	source: docs.toFumadocsSource(),
	icon(icon) {
		if (!icon) {
			// You may set a default icon
			return;
		}

		if (icon in icons) return createElement(icons[icon as keyof typeof icons]);
	},
});
