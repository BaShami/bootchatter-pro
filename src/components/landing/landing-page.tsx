import { Link } from "@tanstack/react-router";
import { useSession } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import heroPhone from "@/assets/landing-hero-phone.png.asset.json";
import howItWorksImg from "@/assets/landing-how-it-works.png.asset.json";
import businessCaseImg from "@/assets/landing-business-case.png.asset.json";

const brandBlue = "#2b68ff";
const darkNavy = "#0b1220";
const warmWhite = "#fafaf8";
const mutedBorder = "#e8e8e6";

function BrandLogo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
        style={{ backgroundColor: brandBlue }}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
          <path d="M2 22V2h20v16H6l-4 4zm2-6h16V4H4v12zm2-8h12v2H6V8zm0 4h9v2H6v-2z" />
        </svg>
      </div>
      <span className="text-lg font-semibold tracking-tight text-slate-900">
        BootChatter Pro
      </span>
    </div>
  );
}

function SectionLabel({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return (
    <span
      className={cn(
        "inline-block text-xs font-semibold uppercase tracking-[0.15em]",
        light ? "text-emerald-400" : "text-[#2b68ff]"
      )}
    >
      {children}
    </span>
  );
}

function LandingHeader() {
  const { user, loading } = useSession();

  return (
    <header
      className="sticky top-0 z-50 border-b border-[#e8e8e6]"
      style={{ backgroundColor: "rgba(250, 250, 248, 0.9)", backdropFilter: "blur(8px)" }}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <BrandLogo />

        <nav className="hidden items-center gap-8 md:flex">
          <Link
            to="/"
            hash="how-it-works"
            className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
          >
            How it works
          </Link>
          <Link
            to="/"
            hash="features"
            className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
          >
            Features
          </Link>
          <Link
            to="/dashboard"
            className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
          >
            Dashboard
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          {loading ? null : user ? (
            <Button
              asChild
              className="bg-[#2b68ff] text-white hover:bg-[#1c55e3]"
            >
              <Link to="/dashboard">Go to dashboard</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" asChild>
                <Link to="/auth">Log in</Link>
              </Button>
              <Button
                asChild
                className="bg-[#2b68ff] text-white hover:bg-[#1c55e3]"
              >
                <Link to="/auth">Sign up</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function HeroSection() {
  const { user, loading } = useSession();

  return (
    <section
      className="overflow-hidden px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:px-8 lg:pb-24 lg:pt-20"
      style={{ backgroundColor: warmWhite }}
    >
      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="max-w-xl">
          <SectionLabel>WhatsApp Assistant for Bootcamps</SectionLabel>
          <h1 className="mt-5 font-serif text-4xl font-medium leading-[1.1] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            Students text questions. Your course{" "}
            <span className="italic">answers</span> — on WhatsApp.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-600">
            BootChatter turns your lessons and knowledge base into an assistant your students
            simply message on WhatsApp — instant, accurate answers grounded in your own material.
            No new app to install, nothing to teach.
          </p>

          <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            {!loading && !user && (
              <>
                <Button
                  asChild
                  size="lg"
                  className="bg-[#2b68ff] px-6 text-base text-white hover:bg-[#1c55e3]"
                >
                  <Link to="/auth">Start free trial</Link>
                </Button>
                <Button variant="ghost" asChild className="group px-2 text-base text-slate-900">
                  <Link to="/" hash="how-it-works">
                    See how it works{" "}
                    <span className="ml-1 transition-transform group-hover:translate-x-0.5">→</span>
                  </Link>
                </Button>
              </>
            )}
            {!loading && user && (
              <Button
                asChild
                size="lg"
                className="bg-[#2b68ff] px-6 text-base text-white hover:bg-[#1c55e3]"
              >
                <Link to="/dashboard">Go to dashboard</Link>
              </Button>
            )}
          </div>

          <p className="mt-4 text-xs text-slate-500">
            No credit card · Works with the WhatsApp students already have
          </p>
        </div>

        <div className="relative flex justify-center lg:justify-end">
          <div className="relative w-full max-w-sm sm:max-w-md lg:max-w-lg">
            <img
              src={heroPhone.url}
              alt="WhatsApp conversation with the BootChatter AI assistant"
              width={600}
              height={1000}
              loading="eager"
              decoding="async"
              className="h-auto w-full rounded-[2.5rem] shadow-2xl"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const steps = [
    {
      num: "01",
      title: "Upload your lessons",
      description:
        "Add PDFs, docs, and lesson notes to your bootcamp's knowledge base in a few clicks.",
    },
    {
      num: "02",
      title: "Students message on WhatsApp",
      description:
        "They use the messaging app they already know. No installs, no new logins.",
    },
    {
      num: "03",
      title: "Answers from your material",
      description:
        "BootChatter replies instantly, grounded in your content and runs quizzes, and flags anything that needs a real instructor.",
    },
  ];

  return (
    <section
      id="how-it-works"
      className="px-4 py-20 sm:px-6 lg:px-8"
      style={{ backgroundColor: warmWhite }}
    >
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-end lg:gap-16">
          <div>
            <SectionLabel>How it works</SectionLabel>
            <h2 className="mt-4 font-serif text-3xl font-medium leading-tight tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
              Live in an afternoon. No engineering, no app rollout.
            </h2>
          </div>
          <p className="text-lg leading-relaxed text-slate-600">
            You bring the course material. BootChatter handles the rest — on the messaging app your
            students open every day.
          </p>
        </div>

        <div className="mt-12 overflow-hidden rounded-3xl shadow-xl">
          <img
            src={howItWorksImg.url}
            alt="Instructor uploading lesson files and students messaging the AI assistant on WhatsApp"
            width={1200}
            height={700}
            loading="lazy"
            decoding="async"
            className="h-auto w-full"
          />
        </div>

        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step) => (
            <div key={step.num} className="border-t border-[#e8e8e6] pt-6">
              <span className="text-sm font-semibold text-[#2b68ff]">{step.num}</span>
              <h3 className="mt-3 text-lg font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-2 text-slate-600">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  const features = [
    {
      num: "01",
      title: "Grounded in your material",
      description:
        "Answers come only from your lessons and knowledge base — never the open internet. Accurate, on-curriculum, every time.",
    },
    {
      num: "02",
      title: "Nothing to install",
      description:
        "It lives entirely inside WhatsApp. Zero onboarding for students, zero new tools for you to support.",
    },
    {
      num: "03",
      title: "Instant answers, 24/7",
      description:
        "Students get unblocked the moment they're stuck — at 2pm or 2am — without waiting on a TA or the next session.",
    },
    {
      num: "04",
      title: "Auto-generated quizzes",
      description:
        'A quick reply of "QUIZ" turns the latest lesson into a 3-question check. Students answer A, B or C and get scored.',
    },
    {
      num: "05",
      title: "Dashboard & analytics",
      description:
        "See every question, confidence scores, and engagement at a glance — so you know exactly where a cohort is struggling.",
    },
    {
      num: "06",
      title: "Run multiple bootcamps",
      description:
        "Manage cohorts, students, and content side by side. Each bootcamp gets its own knowledge base, kept neatly separate.",
    },
  ];

  return (
    <section
      id="features"
      className="px-4 py-20 sm:px-6 lg:px-8"
      style={{ backgroundColor: "#f4f4f2" }}
    >
      <div className="mx-auto max-w-7xl">
        <SectionLabel>What you get</SectionLabel>
        <h2 className="mt-4 max-w-2xl font-serif text-3xl font-medium leading-tight tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
          Everything a cohort needs, in the chat they're already in.
        </h2>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.num}
              className="rounded-2xl border border-[#e8e8e6] bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <span className="text-sm font-semibold text-[#2b68ff]">{f.num}</span>
              <h3 className="mt-3 text-lg font-semibold text-slate-900">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BusinessCaseSection() {
  return (
    <section className="px-4 py-20 sm:px-6 lg:px-8" style={{ backgroundColor: darkNavy }}>
      <div className="mx-auto max-w-7xl">
        <SectionLabel light>The business case</SectionLabel>
        <h2 className="mt-4 max-w-xl font-serif text-3xl font-medium leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">
          Run a bigger bootcamp with a smaller team.
        </h2>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">
          BootChatter handles the questions that used to eat your instructors' evenings — so you
          can add cohorts without adding headcount. Happier students finish, refer, and come back.
          You watch revenue, enrollments and completion build in one place.
        </p>

        <div className="mt-12 overflow-hidden rounded-3xl shadow-2xl">
          <img
            src={businessCaseImg.url}
            alt="Bootcamp analytics dashboard showing revenue, enrollments, and student engagement"
            width={1200}
            height={675}
            loading="lazy"
            decoding="async"
            className="h-auto w-full"
          />
        </div>

        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
              <span className="text-lg">↑</span>
            </div>
            <div>
              <h3 className="font-semibold text-white">More revenue per cohort.</h3>
              <p className="mt-1 text-sm text-slate-400">
                Higher completion drives referrals and repeat enrollments.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
              <span className="text-lg">↓</span>
            </div>
            <div>
              <h3 className="font-semibold text-white">Lower cost to run.</h3>
              <p className="mt-1 text-sm text-slate-400">
                Most questions answered automatically — your team teaches, not triages.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
              <span className="text-lg">≡</span>
            </div>
            <div>
              <h3 className="font-semibold text-white">Scale, not chaos.</h3>
              <p className="mt-1 text-sm text-slate-400">
                Add cohorts and manage every one from a single dashboard.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function GetStartedSection() {
  const { user, loading } = useSession();

  return (
    <section
      className="px-4 py-20 text-center sm:px-6 lg:px-8"
      style={{ backgroundColor: warmWhite }}
    >
      <div className="mx-auto max-w-2xl">
        <SectionLabel>Get started</SectionLabel>
        <h2 className="mt-4 font-serif text-3xl font-medium leading-tight tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
          Bring your bootcamp to WhatsApp.
        </h2>
        <p className="mt-6 text-lg text-slate-600">
          Set up your first cohort in an afternoon and let your course answer for itself. Free to
          try.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {!loading && !user && (
            <>
              <Button
                asChild
                size="lg"
                className="bg-[#2b68ff] px-6 text-base text-white hover:bg-[#1c55e3]"
              >
                <Link to="/auth">Start free trial</Link>
              </Button>
              <Button
                variant="outline"
                asChild
                size="lg"
                className="border-[#2b68ff] px-6 text-base text-[#2b68ff] hover:bg-[#2b68ff]/5"
              >
                <Link to="/auth">Book a walkthrough</Link>
              </Button>
            </>
          )}
          {!loading && user && (
            <Button
              asChild
              size="lg"
              className="bg-[#2b68ff] px-6 text-base text-white hover:bg-[#1c55e3]"
            >
              <Link to="/dashboard">Go to dashboard</Link>
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-[#e8e8e6] bg-white px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 md:flex-row">
        <div className="flex flex-col items-center gap-4 md:flex-row md:gap-8">
          <BrandLogo />
          <nav className="flex flex-wrap items-center justify-center gap-6 text-sm text-slate-600">
            <Link to="/" hash="how-it-works" className="hover:text-slate-900">
              How it works
            </Link>
            <Link to="/" hash="features" className="hover:text-slate-900">
              Features
            </Link>
            <Link to="/auth" className="hover:text-slate-900">
              Start free trial
            </Link>
          </nav>
        </div>
        <p className="text-center text-sm text-slate-500">
          © {new Date().getFullYear()} BootChatter · Made for bootcamps
        </p>
      </div>
    </footer>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: warmWhite }}>
      <LandingHeader />
      <main>
        <HeroSection />
        <HowItWorksSection />
        <FeaturesSection />
        <BusinessCaseSection />
        <GetStartedSection />
      </main>
      <LandingFooter />
    </div>
  );
}
