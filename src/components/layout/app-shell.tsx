import { BookmarkCheck, Clock3, Database, Layers3, Menu, Radar, Route, Search, Star } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/search", label: "Search", icon: Search },
  { href: "/search?q=Fast%20Money%20opportunities", label: "Fast Money", icon: Clock3 },
  { href: "/search?q=Pipeline%20opportunities", label: "Pipeline", icon: Route },
  { href: "/search?q=Early%20Signals", label: "Early Signals", icon: Radar },
  { href: "/saved-searches", label: "Saved Searches", icon: Star },
  { href: "/saved-projects", label: "Saved Opportunities", icon: BookmarkCheck },
  { href: "/sources", label: "Sources", icon: Database },
  { href: "/dashboard", label: "Workspace", icon: Layers3 },
];

export function AppShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <details className="group relative">
            <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-md border border-zinc-200 bg-white hover:bg-zinc-50">
              <Menu className="size-5" />
            </summary>
            <div className="absolute left-0 top-12 z-40 w-72 rounded-lg border border-zinc-200 bg-white p-2 shadow-xl">
              <Link href="/" className="mb-2 block rounded-md px-3 py-2">
                <span className="block text-sm font-semibold">Sentinel Projects</span>
                <span className="block text-xs text-zinc-500">Construction opportunity search</span>
              </Link>
              <nav className="space-y-1">
                {nav.map((item, index) => (
                  <Link key={item.href} href={item.href} className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950", index === nav.length - 1 && "mt-3 border-t border-zinc-100 pt-3")}>
                    <item.icon className="size-4" />
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </details>
          <Link href="/" className="hidden text-sm font-semibold sm:block">Sentinel Projects</Link>
          <form action="/search" className="mx-auto flex w-full max-w-2xl items-center">
            <input
              name="q"
              placeholder="Search by trade, location, project type, or timeline..."
              className="h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-4 text-sm outline-none focus:border-zinc-400 focus:bg-white"
            />
          </form>
          <Link href="/dashboard" className="hidden rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 md:block">
            Workspace
          </Link>
        </div>
      </header>
      <main className={cn("mx-auto w-full px-4 py-6 sm:px-6 lg:px-8", wide ? "max-w-7xl" : "max-w-6xl")}>{children}</main>
    </div>
  );
}
