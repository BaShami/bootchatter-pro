import { createFileRoute, Link } from "@tanstack/react-router";
import { useSession } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  ssr: false,
  component: LandingPage,
});

function ChatBubbleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} xmlns="http://www.w3.org/2000/svg">
      <rect width="120" height="120" rx="28" fill="#ffffff" />
      <path
        d="M30 42h60v36h-23l-15 13v-13H30z"
        fill="#2f64e6"
      />
    </svg>
  );
}

function LandingPage() {
  const { user, loading } = useSession();

  return (
    <div className="min-h-screen bg-[#2f64e6] text-white flex flex-col">
      {/* Top nav */}
      <header className="w-full px-6 sm:px-10 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ChatBubbleLogo className="h-9 w-9" />
          <span className="text-lg sm:text-xl font-semibold tracking-tight">
            BootChatter Pro
          </span>
        </div>
        <nav className="flex items-center gap-2 sm:gap-3">
          {loading ? null : user ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center justify-center rounded-md bg-white text-[#2f64e6] px-4 py-2 text-sm font-medium shadow-sm hover:bg-white/90 transition-colors"
            >
              Go to dashboard
            </Link>
          ) : (
            <>
              <Link
                to="/auth"
                className="inline-flex items-center justify-center rounded-md border border-white/40 text-white px-4 py-2 text-sm font-medium hover:bg-white/10 transition-colors"
              >
                Log in
              </Link>
              <Link
                to="/auth"
                className="inline-flex items-center justify-center rounded-md bg-white text-[#2f64e6] px-4 py-2 text-sm font-medium shadow-sm hover:bg-white/90 transition-colors"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* Hero */}
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-3xl text-center">
          <div className="flex justify-center mb-10">
            <div className="relative">
              <ChatBubbleLogo className="h-32 w-32 sm:h-40 sm:w-40 drop-shadow-2xl" />
              <span className="absolute bottom-2 right-2 h-5 w-5 sm:h-6 sm:w-6 rounded-full bg-[#1fa855] border-4 border-[#2f64e6]" />
            </div>
          </div>
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight leading-tight">
            BootChatter Pro
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-white/85 leading-relaxed max-w-2xl mx-auto">
            The all-in-one admin platform for bootcamps. Manage lessons,
            students, announcements, and your AI learning brain — all in one
            place.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            {!loading && !user && (
              <>
                <Link
                  to="/auth"
                  className="w-full sm:w-auto inline-flex items-center justify-center rounded-md bg-white text-[#2f64e6] px-7 py-3 text-base font-semibold shadow-lg hover:bg-white/90 transition-colors"
                >
                  Get started
                </Link>
                <Link
                  to="/auth"
                  className="w-full sm:w-auto inline-flex items-center justify-center rounded-md border border-white/40 text-white px-7 py-3 text-base font-semibold hover:bg-white/10 transition-colors"
                >
                  Log in
                </Link>
              </>
            )}
            {!loading && user && (
              <Link
                to="/dashboard"
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-md bg-white text-[#2f64e6] px-7 py-3 text-base font-semibold shadow-lg hover:bg-white/90 transition-colors"
              >
                Go to dashboard
              </Link>
            )}
          </div>
        </div>
      </main>

      <footer className="px-6 py-6 text-center text-sm text-white/70">
        © {new Date().getFullYear()} BootChatter Pro
      </footer>
    </div>
  );
}
