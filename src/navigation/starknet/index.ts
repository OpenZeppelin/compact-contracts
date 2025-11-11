import type { NavigationNode } from "../types";
import currentData from "./current.json";
import twoXData from "./previous-versions/2.x.json";

const current = currentData as NavigationNode[];
const previousVersions: NavigationNode[] = [twoXData as NavigationNode];

const starknetNavigation: NavigationNode[] = [
	...current,
	{
		type: "folder",
		name: "Previous Versions",
		children: previousVersions,
		defaultOpen: true,
	},
];

export default starknetNavigation;
