import Image from "next/image";

const navigation = [
  {
    title: "Start Here",
    items: [
      { title: "Overview", href: "#overview" },
      { title: "What PayNode Solves", href: "#problem" },
      { title: "Protecting Both Sides", href: "#protection" },
      { title: "Escrow Rules", href: "#escrow-rules" },
    ],
  },
  {
    title: "Product",
    items: [
      { title: "Project Timeline", href: "#timeline" },
      { title: "Builder Profile", href: "#builder-profile" },
      { title: "Project Flow", href: "#project-flow" },
      { title: "Reputation", href: "#reputation" },
    ],
  },
  {
    title: "Trust & Safety",
    items: [
      { title: "Security Rules", href: "#security" },
      { title: "Why Arc Network?", href: "#why-arc-network" },
      { title: "FAQ", href: "#faq" },
    ],
  },
];

const escrowScenarios = [
  {
    number: "01",
    badge: "Protects the Client",
    badgeClass: "border-blue-500/25 bg-blue-500/10 text-blue-300",
    title: "The project deadline passes with no delivery",
    description:
      "If the builder does not submit any work before the project deadline, the client becomes eligible to refund the locked payment from the smart contract.",
    result: "Result: the client can recover the escrowed funds.",
  },
  {
    number: "02",
    badge: "Protects the Builder",
    badgeClass:
      "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    title: "The client does not respond after delivery",
    description:
      "When the builder submits the work, a separate 7-day review period begins. During those 7 days, the client can approve, request a revision, or raise a dispute.",
    result:
      "Result: if the client takes no action before the review period ends, the builder becomes eligible to claim the escrowed USDC directly from the smart contract.",
  },
  {
    number: "03",
    badge: "Protects Quality",
    badgeClass:
      "border-violet-500/25 bg-violet-500/10 text-violet-300",
    title: "The client requests a revision",
    description:
      "A revision request closes the current review period. The payment remains securely locked while the builder works on the requested changes.",
    result:
      "Result: no payment is released while the project is in revision.",
  },
  {
    number: "04",
    badge: "Protects Both Sides",
    badgeClass:
      "border-amber-500/25 bg-amber-500/10 text-amber-300",
    title: "The builder submits revised work",
    description:
      "After the builder submits the updated delivery, a new 7-day review period begins for the revised work.",
    result:
      "Result: the client receives a fresh review window, while the builder is protected from an endless unpaid review cycle.",
  },
];

const securityRules = [
  "The builder cannot receive the project payment before submitting work.",
  "The client cannot keep a completed delivery unpaid forever.",
  "The client can refund after the project deadline if no delivery exists.",
  "The payment remains locked while a revision is active.",
  "Every revised delivery starts a new 7-day review period.",
  "Project payments, refunds, settlements, and tips use USDC only.",
];

const faqs = [
  {
    question:
      "What is the difference between the project deadline and the 7-day review period?",
    answer:
      "The project deadline is the time the builder has to submit the initial delivery. The 7-day review period starts only after a delivery is submitted and gives the client time to approve, request a revision, or raise a dispute.",
  },
  {
    question: "What happens if the builder misses the project deadline?",
    answer:
      "If no delivery has been submitted before the project deadline, the client becomes eligible to refund the locked payment from the smart contract.",
  },
  {
    question: "What happens if the client ignores a submitted delivery?",
    answer:
      "The client has 7 days to respond. After that review period expires, the builder becomes eligible to claim the escrowed USDC directly from the smart contract.",
  },
  {
    question: "What happens when a revision is requested?",
    answer:
      "The current review period closes and the payment remains locked. When the builder submits the revised work, a new 7-day review period begins.",
  },
  {
    question: "Can the builder receive payment without delivering work?",
    answer:
      "No. The escrow rules require a delivery before the normal approval or review-expiry settlement path can be used.",
  },
  {
    question:
      "Can the client keep the payment locked forever after delivery?",
    answer:
      "No. The 7-day review period prevents an inactive client from holding the builder's payment indefinitely.",
  },
  {
    question: "Which payment asset does PayNode support?",
    answer:
      "PayNode uses USDC for project escrow, settlement, refunds, and tips. Native network tokens and other ERC-20 tokens are not supported for these payments.",
  },
  {
    question: "Where can developers find the technical implementation?",
    answer:
      "The public GitHub repository contains the contract code, application architecture, implementation details, and development history.",
  },
];

function PayNodeLogo({
  className = "h-11 w-11",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="PayNode logo"
      role="img"
    >
      <defs>
        <linearGradient
          id="paynode-grad"
          x1="0%"
          y1="0%"
          x2="100%"
          y2="100%"
        >
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#A855F7" />
        </linearGradient>

        <filter
          id="paynode-glow"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
        >
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feComposite
            in="SourceGraphic"
            in2="blur"
            operator="over"
          />
        </filter>
      </defs>

      <circle
        cx="28"
        cy="50"
        r="16"
        stroke="url(#paynode-grad)"
        strokeWidth="7"
        filter="url(#paynode-glow)"
      />

      <circle
        cx="72"
        cy="50"
        r="16"
        stroke="url(#paynode-grad)"
        strokeWidth="7"
        filter="url(#paynode-glow)"
      />

      <path
        d="M44 50h12"
        stroke="url(#paynode-grad)"
        strokeWidth="7"
        strokeLinecap="round"
        filter="url(#paynode-glow)"
      />

      <circle
        cx="50"
        cy="50"
        r="4.5"
        fill="#34D399"
        className="animate-pulse"
      />
    </svg>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="max-w-3xl space-y-3">
      {eyebrow && (
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">
          {eyebrow}
        </p>
      )}

      <h2 className="text-2xl font-bold tracking-tight text-white md:text-3xl">
        {title}
      </h2>

      {description && (
        <p className="text-base leading-7 text-slate-400">
          {description}
        </p>
      )}
    </div>
  );
}

function Screenshot({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption: string;
}) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl shadow-black/20">
      <div className="relative aspect-[16/9] w-full">
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(max-width: 768px) 100vw, 900px"
          className="object-contain object-top"
        />
      </div>

      <figcaption className="border-t border-slate-800 px-5 py-3 text-sm text-slate-500">
        {caption}
      </figcaption>
    </figure>
  );
}

function StepNumber({ number }: { number: number }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-blue-500/30 bg-blue-500/10 text-sm font-bold text-blue-300">
      {number}
    </span>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-screen scroll-smooth bg-[#090d16] font-sans text-slate-100 selection:bg-blue-500 selection:text-white">
      <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-[#090d16]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 md:px-8">
          <a href="#overview" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-800 bg-slate-950/70">
              <PayNodeLogo className="h-9 w-9" />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white">
                PayNode Docs
              </span>

              <span className="hidden rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-300 sm:inline-flex">
                Arc Network Testnet
              </span>
            </div>
          </a>

          <nav className="flex items-center gap-2">
            <a
              href="https://github.com/padracrypto/PayNode"
              target="_blank"
              rel="noreferrer"
              className="hidden rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-600 hover:bg-slate-800 hover:text-white sm:inline-flex"
            >
              Technical Docs
            </a>

            <a
              href="https://paynode.online"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              Launch App
            </a>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-5 py-10 md:px-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:py-14">
        <aside className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] space-y-7 overflow-y-auto border-r border-slate-800/80 pr-6">
            {navigation.map((group) => (
              <div key={group.title} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {group.title}
                </h3>

                <ul className="space-y-1">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        className="block rounded-md px-2 py-1.5 text-sm text-slate-400 transition hover:bg-slate-800/70 hover:text-blue-300"
                      >
                        {item.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">
                Payment asset
              </p>

              <p className="mt-2 text-sm font-medium text-white">
                USDC only
              </p>

              <p className="mt-1 text-xs leading-5 text-slate-500">
                Project escrow, settlement, refunds, and tips use
                USDC.
              </p>
            </div>
          </div>
        </aside>

        <main className="min-w-0 space-y-24">
          <section id="overview" className="scroll-mt-24">
            <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-950/60 px-6 py-12 md:px-12 md:py-16">
              <div className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full bg-blue-600/20 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-violet-600/10 blur-3xl" />

              <div className="relative max-w-4xl">
                <div className="mb-6 inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300">
                  Fair escrow for both sides
                </div>

                <h1 className="max-w-4xl text-4xl font-black tracking-tight text-white md:text-6xl">
                  Trust the rules, not the other person.
                </h1>

                <p className="mt-6 max-w-3xl text-xl font-medium leading-8 text-slate-300">
                  PayNode protects the client when work is not
                  delivered and protects the builder when delivered
                  work is ignored.
                </p>

                <p className="mt-5 max-w-3xl text-base leading-8 text-slate-400 md:text-lg">
                  Clients lock the agreed payment in a smart contract.
                  Builders submit their work through the platform.
                  Clear deadlines, review periods, refunds, revisions,
                  and settlement rules keep either side from holding
                  complete control.
                </p>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <a
                    href="#escrow-rules"
                    className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-blue-500"
                  >
                    See How Escrow Works
                  </a>

                  <a
                    href="https://paynode.online"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-5 py-3 text-sm font-bold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
                  >
                    Launch App
                  </a>
                </div>
              </div>
            </div>

            <div className="mt-8 rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-5 md:p-8">
              <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr]">
                {[
                  ["01", "Create Project"],
                  ["02", "Lock Payment"],
                  ["03", "Deliver Work"],
                  ["04", "7-Day Review"],
                  ["05", "Approve or Claim"],
                ].map(([number, title], index) => (
                  <div key={title} className="contents">
                    <div className="flex min-h-24 flex-col justify-center rounded-xl border border-slate-800 bg-slate-900/80 p-4 text-center">
                      <span className="text-xs font-semibold text-blue-400">
                        Step {number}
                      </span>

                      <span className="mt-2 text-sm font-bold text-white">
                        {title}
                      </span>
                    </div>

                    {index < 4 && (
                      <div className="flex items-center justify-center text-xl font-bold text-blue-400">
                        <span className="rotate-90 md:rotate-0">
                          →
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section
            id="problem"
            className="scroll-mt-24 space-y-8"
          >
            <SectionHeading
              eyebrow="What PayNode solves"
              title="Online work creates risk for both sides."
              description="A builder may finish the work and never get paid. A client may fund a project and receive nothing. PayNode replaces open-ended trust with clear rules that both sides can understand before the project begins."
            />

            <div className="grid gap-4 md:grid-cols-2">
              <article className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-6">
                <span className="inline-flex rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-300">
                  For Clients
                </span>

                <h3 className="mt-5 text-xl font-bold text-white">
                  No delivery means a refund path.
                </h3>

                <p className="mt-3 leading-7 text-slate-400">
                  If the project deadline passes and the builder has
                  not submitted any work, the client becomes eligible
                  to recover the locked payment.
                </p>
              </article>

              <article className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
                <span className="inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                  For Builders
                </span>

                <h3 className="mt-5 text-xl font-bold text-white">
                  Delivered work cannot be ignored forever.
                </h3>

                <p className="mt-3 leading-7 text-slate-400">
                  After delivery, the client has 7 days to respond. If
                  no action is taken, the builder becomes eligible to
                  claim the escrowed payment.
                </p>
              </article>
            </div>
          </section>

          <section
            id="protection"
            className="scroll-mt-24 space-y-8"
          >
            <SectionHeading
              eyebrow="Balanced by design"
              title="PayNode does not give complete control to either side."
              description="The builder cannot receive payment without delivering the work, and the client cannot keep a completed delivery unpaid forever."
            />

            <div className="rounded-3xl border border-slate-800 bg-slate-950 p-6 md:p-8">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">
                    Before delivery
                  </p>

                  <h3 className="mt-3 font-bold text-white">
                    The project deadline protects the client.
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    The builder must submit work before the agreed
                    project deadline.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                    After delivery
                  </p>

                  <h3 className="mt-3 font-bold text-white">
                    The 7-day review period protects the builder.
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    The client must approve, request a revision, or
                    raise a dispute within 7 days.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-violet-400">
                    During revision
                  </p>

                  <h3 className="mt-3 font-bold text-white">
                    The payment stays locked.
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Revised work starts a fresh 7-day review period.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section
            id="escrow-rules"
            className="scroll-mt-24 space-y-8"
          >
            <SectionHeading
              eyebrow="The core of PayNode"
              title="How the escrow handles real project scenarios"
              description="These four rules are the foundation of the contract and explain how PayNode protects both participants."
            />

            <div className="grid gap-4 md:grid-cols-2">
              {escrowScenarios.map((scenario) => (
                <article
                  key={scenario.number}
                  className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6"
                >
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs font-bold text-slate-500">
                      Scenario {scenario.number}
                    </span>

                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${scenario.badgeClass}`}
                    >
                      {scenario.badge}
                    </span>
                  </div>

                  <h3 className="mt-5 text-lg font-bold text-white">
                    {scenario.title}
                  </h3>

                  <p className="mt-3 text-sm leading-7 text-slate-400">
                    {scenario.description}
                  </p>

                  <p className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-sm font-medium leading-6 text-slate-200">
                    {scenario.result}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section
            id="timeline"
            className="scroll-mt-24 space-y-8"
          >
            <SectionHeading
              eyebrow="Two different clocks"
              title="Project deadline and review period are not the same."
              description="The project deadline applies before delivery. The 7-day review period applies only after the builder submits work."
            />

            <div className="overflow-hidden rounded-2xl border border-slate-800">
              <div className="grid md:grid-cols-2">
                <div className="border-b border-slate-800 p-6 md:border-b-0 md:border-r">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-400">
                    Project deadline
                  </p>

                  <h3 className="mt-3 text-xl font-bold text-white">
                    Before the first delivery
                  </h3>

                  <p className="mt-3 text-sm leading-7 text-slate-400">
                    This is the agreed amount of time the builder has
                    to submit the project. It can be 5 days, 10 days,
                    or another duration selected for that project.
                  </p>

                  <p className="mt-4 text-sm font-semibold text-blue-300">
                    No delivery by this deadline → the client can
                    refund.
                  </p>
                </div>

                <div className="p-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-400">
                    7-day review period
                  </p>

                  <h3 className="mt-3 text-xl font-bold text-white">
                    After each delivery
                  </h3>

                  <p className="mt-3 text-sm leading-7 text-slate-400">
                    Once work is submitted, the client receives
                    exactly 7 days to approve it, request a revision,
                    or raise a dispute.
                  </p>

                  <p className="mt-4 text-sm font-semibold text-emerald-300">
                    No response within 7 days → the builder can claim.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section
            id="builder-profile"
            className="scroll-mt-24 space-y-8"
          >
            <SectionHeading
              eyebrow="One link for builders"
              title="A PayNode profile is more than a portfolio."
              description="It brings skills, completed projects, client ratings, social links, and wallet-based payments together in one shareable professional identity."
            />

            <div className="grid items-start gap-8 xl:grid-cols-[0.85fr_1.15fr]">
              <div className="space-y-4">
                {[
                  "Share one profile on X, Discord, Telegram, LinkedIn, GitHub, or a personal website.",
                  "Receive project invitations through the same public link.",
                  "Accept USDC tips from people who want to support your work.",
                  "Build visible reputation through completed projects and ratings.",
                ].map((item) => (
                  <div
                    key={item}
                    className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4"
                  >
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-bold text-emerald-400">
                      ✓
                    </span>

                    <p className="text-sm leading-6 text-slate-300">
                      {item}
                    </p>
                  </div>
                ))}
              </div>

              <Screenshot
                src="/4.png"
                alt="PayNode builder profile"
                caption="A shareable PayNode profile combining skills, social links, project history, ratings, project requests, and USDC tips."
              />
            </div>
          </section>

          <section
            id="project-flow"
            className="scroll-mt-24 space-y-14"
          >
            <SectionHeading
              eyebrow="Product walkthrough"
              title="A simple project flow"
              description="The user-facing process stays simple, while the contract applies the rules in the background."
            />

            <article className="space-y-6">
              <div className="flex items-start gap-4">
                <StepNumber number={1} />

                <div>
                  <h3 className="text-xl font-bold text-white">
                    Create the agreement
                  </h3>

                  <p className="mt-2 max-w-3xl leading-7 text-slate-400">
                    The client defines the project, budget, project
                    deadline, delivery expectations, and revision
                    limit. The payment is priced in USDC.
                  </p>
                </div>
              </div>

              <Screenshot
                src="/10.png"
                alt="Creating a PayNode project"
                caption="The client defines the project terms, budget, deadline, and revision rules."
              />
            </article>

            <article className="space-y-6">
              <div className="flex items-start gap-4">
                <StepNumber number={2} />

                <div>
                  <h3 className="text-xl font-bold text-white">
                    Lock the payment in escrow
                  </h3>

                  <p className="mt-2 max-w-3xl leading-7 text-slate-400">
                    The client funds the smart contract before work
                    begins. The builder can see that the agreed
                    payment is secured.
                  </p>
                </div>
              </div>

              <Screenshot
                src="/11.png"
                alt="Funding a PayNode escrow project"
                caption="The agreed payment is locked before the builder starts working."
              />
            </article>

            <article className="space-y-6">
              <div className="flex items-start gap-4">
                <StepNumber number={3} />

                <div>
                  <h3 className="text-xl font-bold text-white">
                    Submit the work
                  </h3>

                  <p className="mt-2 max-w-3xl leading-7 text-slate-400">
                    The builder submits delivery notes and links to
                    the final work. This action begins the 7-day
                    review period.
                  </p>
                </div>
              </div>

              <Screenshot
                src="/13.png"
                alt="Submitting work through PayNode"
                caption="Submitting a delivery starts the client's 7-day review period."
              />
            </article>

            <article className="space-y-6">
              <div className="flex items-start gap-4">
                <StepNumber number={4} />

                <div>
                  <h3 className="text-xl font-bold text-white">
                    Approve, revise, dispute, or wait
                  </h3>

                  <p className="mt-2 max-w-3xl leading-7 text-slate-400">
                    The client can approve the work, request a
                    revision, or raise a dispute. If the client does
                    nothing for 7 days, the builder becomes eligible
                    to claim the payment.
                  </p>
                </div>
              </div>

              <Screenshot
                src="/16.png"
                alt="PayNode project review and payment"
                caption="Approval releases payment. No response for 7 days enables the builder's claim path."
              />
            </article>
          </section>

          <section
            id="reputation"
            className="scroll-mt-24 space-y-8"
          >
            <SectionHeading
              eyebrow="Builder reputation"
              title="Successful work becomes public credibility."
              description="Every completed project and client rating can strengthen the builder's profile and help future clients make a more confident hiring decision."
            />

            <div className="grid items-start gap-8 xl:grid-cols-[0.85fr_1.15fr]">
              <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-6">
                <h3 className="text-xl font-bold text-white">
                  A strong profile creates long-term value.
                </h3>

                <p className="mt-3 leading-7 text-slate-400">
                  High ratings and successful project history act as
                  visible proof of reliability. Builders can keep
                  sharing the same link as their reputation grows.
                </p>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {[
                    "More trust before a new project",
                    "A visible history of completed work",
                    "One link for projects and tips",
                    "Reputation that grows over time",
                  ].map((item) => (
                    <div
                      key={item}
                      className="rounded-xl border border-violet-500/15 bg-slate-950/40 p-4 text-sm text-slate-300"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <Screenshot
                src="/17.png"
                alt="PayNode builder rating"
                caption="Client ratings and completed projects strengthen the builder's public reputation."
              />
            </div>
          </section>

          <section
            id="security"
            className="scroll-mt-24 space-y-8"
          >
            <SectionHeading
              eyebrow="Security rules"
              title="Simple rules users can understand before they connect a wallet."
              description="The most important protections are visible and predictable. Users do not need to understand contract code to understand their rights."
            />

            <div className="grid gap-4 md:grid-cols-2">
              {securityRules.map((rule) => (
                <div
                  key={rule}
                  className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-5"
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-bold text-emerald-400">
                    ✓
                  </span>

                  <p className="text-sm leading-6 text-slate-300">
                    {rule}
                  </p>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
              <h3 className="font-semibold text-red-200">
                PayNode will never ask for a seed phrase or private
                key.
              </h3>

              <p className="mt-2 text-sm leading-6 text-slate-400">
                Review every wallet request before signing and use
                only the official PayNode application.
              </p>
            </div>
          </section>

          <section
            id="why-arc-network"
            className="scroll-mt-24 overflow-hidden rounded-3xl border border-blue-500/25 bg-gradient-to-br from-blue-950/30 via-slate-950 to-violet-950/20 p-7 md:p-10"
          >
            <SectionHeading
              eyebrow="Built on Arc Network"
              title="Programmable rules make the escrow predictable."
              description="PayNode uses Arc Network to turn deadlines, review periods, revisions, refunds, and settlement into transparent smart contract rules instead of private platform decisions."
            />

            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <a
                href="https://github.com/padracrypto/PayNode"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-950/60 px-5 py-3 text-sm font-bold text-slate-200 transition hover:border-slate-600 hover:bg-slate-900"
              >
                View Contract & Architecture on GitHub
              </a>

              <a
                href="https://paynode.online"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-blue-500"
              >
                Launch PayNode
              </a>
            </div>
          </section>

          <section id="faq" className="scroll-mt-24 space-y-8">
            <SectionHeading
              eyebrow="Questions"
              title="Frequently asked questions"
              description="The essential rules to understand before starting a project."
            />

            <div className="space-y-3">
              {faqs.map((faq) => (
                <details
                  key={faq.question}
                  className="group rounded-2xl border border-slate-800 bg-slate-900/40"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 font-semibold text-white">
                    {faq.question}

                    <span className="text-xl font-light text-blue-400 transition group-open:rotate-45">
                      +
                    </span>
                  </summary>

                  <div className="border-t border-slate-800 px-5 py-4">
                    <p className="text-sm leading-7 text-slate-400">
                      {faq.answer}
                    </p>
                  </div>
                </details>
              ))}
            </div>
          </section>

          <section className="overflow-hidden rounded-3xl border border-blue-500/25 bg-gradient-to-r from-blue-600/15 to-violet-600/10 p-8 text-center md:p-12">
            <PayNodeLogo className="mx-auto h-16 w-16" />

            <h2 className="mt-4 text-3xl font-black tracking-tight text-white md:text-4xl">
              One link. Fair rules. Secure payment.
            </h2>

            <p className="mx-auto mt-4 max-w-2xl leading-7 text-slate-400">
              Build your reputation, receive tips, start protected
              projects, and get paid through a balanced escrow
              workflow.
            </p>

            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <a
                href="https://paynode.online"
                target="_blank"
                rel="noreferrer"
                className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-blue-500"
              >
                Launch App
              </a>

              <a
                href="https://github.com/padracrypto/PayNode"
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-slate-700 bg-slate-950/50 px-6 py-3 text-sm font-bold text-slate-200 transition hover:border-slate-600 hover:bg-slate-900"
              >
                Technical Details
              </a>
            </div>
          </section>

          <footer className="border-t border-slate-800 py-8">
            <div className="flex flex-col items-center justify-between gap-4 text-center md:flex-row md:text-left">
              <div className="flex items-center gap-3">
                <PayNodeLogo className="h-10 w-10" />

                <div>
                  <p className="font-bold text-white">
                    PayNode
                  </p>

                  <p className="mt-1 text-sm text-slate-500">
                    Fair escrow and reputation for Web3
                    collaboration.
                  </p>
                </div>
              </div>

              <div className="text-sm text-slate-500">
                Built on Arc Network. Powered by USDC. Made for
                builders and clients.
              </div>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}