import { createOpenAPI } from "fumadocs-openapi/server";

export const openapi = createOpenAPI({
	input: [
		"https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-relayer/refs/heads/main/openapi.json",
	],
});
