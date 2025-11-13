"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RootProvider } from "fumadocs-ui/provider";
import { type ReactNode, useState } from "react";
import SearchDialog from "@/components/search";

export function Provider({ children }: { children: ReactNode }) {
	// Create a client instance
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						// With SSR, we usually want to set some default staleTime
						// above 0 to avoid refetching immediately on the client
						staleTime: 60 * 1000, // 1 minute
						gcTime: 5 * 60 * 1000, // 5 minutes
						retry: 1,
						refetchOnWindowFocus: false,
					},
				},
			}),
	);

	return (
		<QueryClientProvider client={queryClient}>
			<RootProvider
				search={{
					SearchDialog,
				}}
			>
				{children}
			</RootProvider>
		</QueryClientProvider>
	);
}
