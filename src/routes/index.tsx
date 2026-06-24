import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "@/components/landing/landing-page";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "BootChatter Pro — WhatsApp Assistant for Bootcamps" },
      {
        name: "description",
        content:
          "Turn your bootcamp lessons and knowledge base into a WhatsApp assistant. Students get instant, accurate answers grounded in your material — no new app required.",
      },
      {
        property: "og:title",
        content: "BootChatter Pro — WhatsApp Assistant for Bootcamps",
      },
      {
        property: "og:description",
        content:
          "Turn your bootcamp lessons and knowledge base into a WhatsApp assistant. Students get instant, accurate answers grounded in your material — no new app required.",
      },
    ],
  }),
  component: LandingPage,
});
