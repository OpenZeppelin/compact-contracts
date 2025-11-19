"use client";

import { allVersions } from "content/monitor/latest-versions";
import { VersionSelector } from "./version-selector";

export function MonitorVersionSelector() {
	return <VersionSelector pathPrefix="/monitor" versions={allVersions} />;
}
