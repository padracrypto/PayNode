import Image from "next/image";

const navigation = [
  {
    title: "Getting Started",
    items: [
      { title: "Overview", href: "#overview" },
      { title: "The Problem", href: "#problem" },
      { title: "Core Features", href: "#features" },
      { title: "Why Arc Network?", href: "#why-arc-network" },
    ],
  },
  {
    title: "Product Lifecycle",
    items: [
      { title: "1. Builder Profile", href: "#builder-profile" },
      { title: "2. Create Project", href: "#create-project" },
      { title: "3. Fund USDC Escrow", href: "#fund-escrow" },
      { title: "4. Deliver Work", href: "#deliver-work" },
      { title: "5. Release USDC", href: "#release-payment" },
      { title: "6. Rating", href: "#rating" },
    ],
  },
  {
    title: "Technical",
    items: [
      { title: "Project States", href: "#project-states" },
      { title: "Smart Contract", href: "#smart-contract" },
      { title: "Architecture", href: "#architecture" },
      { title: "Synchronization", href: "#synchronization" },
      { title: "Security", href: "#security" },
    ],
  },
  {
    title: "Resources",
    items: [{ title: "FAQ", href: "#faq" }],
  },
];

const features = [
  {
    icon: "🔒",
    title: "USDC Smart Contract Escrow",
    description:
      "The agreed USDC payment is locked on-chain before work begins and released according to the project workflow.",
  },
  {
    icon: "👤",
    title: "Builder Profiles",
    description:
      "Builders can share their skills, social links, wallet identity, completed projects, and professional reputation.",
  },
  {
    icon: "📦",
    title: "Verifiable Delivery",
    description:
      "Builders submit delivery notes and links such as GitHub repositories, live demos, designs, or documents.",
  },
  {
    icon: "⭐",
    title: "Reputation",
    description:
      "Completed projects and client ratings create a transparent professional history for each builder.",
  },
  {
    icon: "☕",
    title: "USDC Tipping",
    description:
      "Visitors can support builders and creators directly by sending USDC through their public PayNode profile.",
  },
  {
    icon: "🔍",
    title: "Transparent USDC Activity",
    description:
      "USDC deposits, releases, refunds, and project events can be verified through the Arc Network explorer.",
  },
];

const contractFunctions = [
  {
    name: "createProject()",
    description:
      "Creates a new USDC escrow agreement between a client and a builder.",
  },
  {
    name: "approve()",
    description:
      "Allows the client to approve the escrow contract to transfer the exact project amount of USDC.",
  },
  {
    name: "fundProject()",
    description:
      "Uses USDC transferFrom() to move the approved project amount into the escrow contract.",
  },
  {
    name: "requestRevision()",
    description:
      "Allows the client to request another delivery while the USDC remains locked in escrow.",
  },
  {
    name: "releaseFunds()",
    description:
      "Transfers the escrowed USDC from the contract to the builder after approval.",
  },
  {
    name: "cancelProject()",
    description:
      "Cancels an eligible project or returns escrowed USDC according to the contract rules.",
  },
  {
    name: "raiseDispute()",
    description:
      "Pauses normal settlement and keeps the project USDC locked during a dispute.",
  },
];

const projectStates = [
  {
    status: "Awaiting USDC",
    color: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    description:
      "The agreement has been created, but the client has not deposited the required USDC yet.",
  },
  {
    status: "USDC Funded",
    color: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    description:
      "The agreed USDC amount is locked in the escrow contract and the builder can begin work.",
  },
  {
    status: "In Revision",
    color: "border-violet-500/30 bg-violet-500/10 text-violet-300",
    description:
      "The client requested a revision while the USDC remains secured inside the escrow contract.",
  },
  {
    status: "Completed",
    color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    description:
      "The client approved the work and the contract transferred the escrowed USDC to the builder.",
  },
  {
    status: "Disputed",
    color: "border-red-500/30 bg-red-500/10 text-red-300",
    description:
      "A dispute was raised and the USDC remains locked while the normal project flow is paused.",
  },
  {
    status: "Cancelled / Refunded",
    color: "border-slate-500/30 bg-slate-500/10 text-slate-300",
    description:
      "The project was cancelled or the escrowed USDC was returned according to the contract rules.",
  },
];

const securityItems = [
  {
    title: "Wallet-based access",
    description:
      "USDC approvals, escrow deposits, releases, and refunds require authorization through the connected wallet.",
  },
  {
    title: "Non-custodial USDC escrow",
    description:
      "USDC is managed by the escrow smart contract rather than a private PayNode platform wallet.",
  },
  {
    title: "Exact approval amount",
    description:
      "The client approves only the USDC amount required for the selected project.",
  },
  {
    title: "Role-based actions",
    description:
      "Only authorized client or builder wallets can perform their corresponding project actions.",
  },
  {
    title: "Transparent USDC settlement",
    description:
      "USDC deposits, releases, and refunds can be inspected through the Arc Network explorer.",
  },
  {
    title: "Token decimal normalization",
    description:
      "USDC amounts are converted using the token decimal configuration before blockchain transactions are submitted.",
  },
];

const faqs = [
  {
    question: "What is PayNode?",
    answer:
      "PayNode is a Web3 collaboration and USDC payment platform that gives builders a public professional profile and lets clients create escrow-backed projects with them.",
  },
  {
    question: "Is PayNode a freelance marketplace?",
    answer:
      "Not in its current version. Clients and builders can find each other through X, Discord, LinkedIn, Telegram, GitHub, or any other platform. PayNode secures the agreement, delivery, and USDC payment.",
  },
  {
    question: "Which currencies does PayNode support?",
    answer:
      "PayNode supports only USDC. Native network tokens and other ERC-20 tokens cannot be used for project escrow, settlement, refunds, or tips.",
  },
  {
    question: "Why does PayNode use only USDC?",
    answer:
      "USDC gives clients and builders a stable unit for pricing work. A project agreed at 500 USDC remains priced at 500 USDC throughout the project workflow.",
  },
  {
    question: "Who controls the project USDC?",
    answer:
      "After funding, the escrow smart contract controls the project's USDC according to its rules. PayNode does not hold project funds inside a private platform wallet.",
  },
  {
    question: "Can a builder withdraw USDC before approval?",
    answer:
      "No. The builder cannot independently withdraw the escrowed USDC. Settlement occurs through the contract workflow after client approval.",
  },
  {
    question: "What can a builder submit as delivery?",
    answer:
      "A delivery can include notes and links to a GitHub repository, live website, design file, document, video, or another agreed deliverable.",
  },
  {
    question: "Why is a wallet not required for browsing?",
    answer:
      "Public profiles and documentation can be viewed without connecting a wallet. Wallet connection is only requested when a user needs to perform a signed or financial action.",
  },
  {
    question: "Why was PayNode built on Arc Network?",
    answer:
      "PayNode uses Arc Network to demonstrate a programmable USDC workflow in which project agreements, escrow deposits, revisions, releases, and refunds are executed transparently on-chain.",
  },
];

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
        <p className="text-base leading-7 text-slate-400">{description}</p>
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
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-black text-white shadow-lg shadow-blue-500/20">
              P
            </div>

            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white">PayNode Docs</span>

              <span className="hidden rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-300 sm:inline-flex">
                v1.0 · Arc Network Testnet
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
              GitHub
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

              <p className="mt-2 text-sm font-medium text-white">USDC only</p>

              <p className="mt-1 text-xs leading-5 text-slate-500">
                Project escrow, settlement, refunds, and tipping are exclusively
                denominated in USDC.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Current network
              </p>

              <p className="mt-2 text-sm font-medium text-white">
                Arc Network Testnet
              </p>
            </div>
          </div>
        </aside>

        <main className="min-w-0 space-y-24">
          <section id="overview" className="scroll-mt-24">
            <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-950/60 px-6 py-12 md:px-12 md:py-16">
              <div className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full bg-blue-600/20 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-indigo-600/10 blur-3xl" />

              <div className="relative max-w-4xl">
                <div className="mb-6 inline-flex items-center rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-blue-300">
                  USDC escrow infrastructure
                </div>

                <h1 className="max-w-3xl text-4xl font-black tracking-tight text-white md:text-6xl">
                  Secure collaboration for Web3 builders and clients.
                </h1>

                <p className="mt-6 text-xl font-medium text-slate-300">
                  One Link. Get Hired. Get Paid.
                </p>

                <p className="mt-5 max-w-3xl text-base leading-8 text-slate-400 md:text-lg">
                  PayNode is a USDC-based collaboration and escrow platform
                  built on Arc Network. Clients create projects and lock the
                  agreed USDC payment inside a smart contract. Builders deliver
                  their work, and the USDC is released after client approval.
                </p>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <a
                    href="https://paynode.online"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-blue-500"
                  >
                    Launch PayNode
                  </a>

                  <a
                    href="https://github.com/padracrypto/PayNode"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-5 py-3 text-sm font-bold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
                  >
                    View public repository
                  </a>
                </div>
              </div>
            </div>

            <div className="mt-8 rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-5 md:p-8">
              <div className="mb-6 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  USDC payment workflow
                </p>

                <h2 className="mt-2 text-xl font-bold text-white">
                  From agreement to USDC settlement
                </h2>
              </div>

              <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr]">
                {[
                  ["01", "Create Project"],
                  ["02", "Lock USDC"],
                  ["03", "Deliver Work"],
                  ["04", "Client Approves"],
                  ["05", "Receive USDC"],
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
                        <span className="rotate-90 md:rotate-0">→</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="problem" className="scroll-mt-24 space-y-8">
            <SectionHeading
              eyebrow="Problem and solution"
              title="Freelance collaboration still depends heavily on personal trust."
              description="When two people meet online, both sides take a risk. The builder may complete the work and never get paid. The client may pay in advance and never receive the expected delivery. PayNode turns the agreement into an enforceable on-chain USDC payment workflow."
            />

            <div className="overflow-hidden rounded-2xl border border-slate-800">
              <div className="grid grid-cols-2 border-b border-slate-800 bg-slate-900/80">
                <div className="p-4 text-sm font-semibold text-slate-300 md:p-5">
                  Traditional workflow
                </div>

                <div className="border-l border-slate-800 p-4 text-sm font-semibold text-blue-300 md:p-5">
                  PayNode workflow
                </div>
              </div>

              {[
                ["Payment depends on trust", "USDC is locked in escrow"],
                [
                  "A builder may face payment withholding",
                  "USDC is secured before work begins",
                ],
                [
                  "A client may lose an upfront payment",
                  "USDC is released only after approval",
                ],
                [
                  "Payment value may change during the project",
                  "USDC provides stable project pricing",
                ],
                [
                  "Centralized platforms control settlement",
                  "USDC settlement executes on-chain",
                ],
                [
                  "Professional history can be difficult to verify",
                  "Completed work contributes to reputation",
                ],
              ].map(([traditional, paynode]) => (
                <div
                  key={traditional}
                  className="grid grid-cols-2 border-b border-slate-800/80 last:border-b-0"
                >
                  <div className="p-4 text-sm leading-6 text-slate-500 md:p-5">
                    {traditional}
                  </div>

                  <div className="border-l border-slate-800 p-4 text-sm leading-6 text-slate-300 md:p-5">
                    {paynode}
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-6">
              <p className="text-base font-semibold text-white">
                PayNode does not replace X, Discord, Telegram, LinkedIn, or
                email.
              </p>

              <p className="mt-2 leading-7 text-slate-400">
                Clients and builders can negotiate wherever they already
                communicate. PayNode is used after they agree, providing a
                shared contract, verifiable delivery flow, and secure USDC
                payment.
              </p>
            </div>
          </section>

          <section id="features" className="scroll-mt-24 space-y-8">
            <SectionHeading
              eyebrow="Core product"
              title="One profile for visibility, collaboration, and USDC payment."
              description="PayNode combines a shareable Web3 professional profile with a USDC escrow-backed project workflow."
            />

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {features.map((feature) => (
                <article
                  key={feature.title}
                  className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 transition hover:border-slate-700 hover:bg-slate-900/70"
                >
                  <div className="text-2xl">{feature.icon}</div>

                  <h3 className="mt-4 font-bold text-white">{feature.title}</h3>

                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {feature.description}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section
            id="why-arc-network"
            className="scroll-mt-24 overflow-hidden rounded-3xl border border-blue-500/25 bg-gradient-to-br from-blue-950/30 via-slate-950 to-indigo-950/20 p-7 md:p-10"
          >
            <SectionHeading
              eyebrow="Network"
              title="Why Arc Network?"
              description="PayNode was designed as a programmable USDC payment workflow. Project creation, USDC escrow funding, approval, refunds, and settlement are represented by explicit smart contract actions rather than informal promises."
            />

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {[
                {
                  title: "Programmable USDC settlement",
                  text: "USDC moves according to smart contract conditions instead of manual platform decisions.",
                },
                {
                  title: "Transparent transactions",
                  text: "USDC deposits, releases, and refunds can be inspected through Arc Network transaction history.",
                },
                {
                  title: "Stable project pricing",
                  text: "Using USDC prevents project budgets from changing because of native token price volatility.",
                },
                {
                  title: "Builder-focused infrastructure",
                  text: "Arc Network Testnet provides the environment in which PayNode can test its complete USDC escrow workflow.",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-blue-500/15 bg-slate-950/50 p-5"
                >
                  <h3 className="font-bold text-white">{item.title}</h3>

                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {item.text}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-16">
            <SectionHeading
              eyebrow="Product walkthrough"
              title="The complete project lifecycle"
              description="The following screens show how a client and a builder move through the PayNode USDC escrow workflow."
            />

            <article id="builder-profile" className="scroll-mt-24 space-y-6">
              <div className="flex items-start gap-4">
                <StepNumber number={1} />

                <div>
                  <h3 className="text-xl font-bold text-white">
                    Create a builder profile
                  </h3>

                  <p className="mt-2 max-w-3xl leading-7 text-slate-400">
                    A builder creates a shareable professional identity with a
                    username, biography, skills, wallet address, and social
                    links such as GitHub, X, LinkedIn, and a personal website.
                    This page becomes the builder&apos;s main PayNode link.
                  </p>
                </div>
              </div>

              <Screenshot
                src="/4.png"
                alt="PayNode builder profile"
                caption="A public PayNode profile displaying builder identity, skills, social links, and project reputation."
              />
            </article>

            <article id="create-project" className="scroll-mt-24 space-y-6">
              <div className="flex items-start gap-4">
                <StepNumber number={2} />

                <div>
                  <h3 className="text-xl font-bold text-white">
                    Create the project agreement
                  </h3>

                  <p className="mt-2 max-w-3xl leading-7 text-slate-400">
                    After the parties negotiate externally, the client opens
                    the builder&apos;s profile and creates a project. The
                    agreement includes the title, description, USDC budget,
                    deadline, builder address, delivery expectations, and
                    allowed revision count. Every project created through
                    PayNode is priced exclusively in USDC.
                  </p>
                </div>
              </div>

              <Screenshot
                src="/10.png"
                alt="Creating a PayNode project"
                caption="The client defines the agreed project terms and USDC budget before creating the escrow agreement."
              />
            </article>

            <article id="fund-escrow" className="scroll-mt-24 space-y-6">
              <div className="flex items-start gap-4">
                <StepNumber number={3} />

                <div>
                  <h3 className="text-xl font-bold text-white">
                    Fund the USDC escrow
                  </h3>

                  <p className="mt-2 max-w-3xl leading-7 text-slate-400">
                    The newly created project begins in the{" "}
                    <strong className="font-semibold text-slate-200">
                      Awaiting USDC
                    </strong>{" "}
                    state. The client first approves the PayNode escrow
                    contract to spend the exact project amount and then submits
                    the USDC funding transaction. After confirmation, the
                    contract holds the USDC and marks the project as funded.
                  </p>
                </div>
              </div>

              <Screenshot
                src="/11.png"
                alt="Funding a PayNode USDC escrow project"
                caption="The project dashboard after the agreed USDC amount has been locked in the escrow contract."
              />
            </article>

            <article id="deliver-work" className="scroll-mt-24 space-y-6">
              <div className="flex items-start gap-4">
                <StepNumber number={4} />

                <div>
                  <h3 className="text-xl font-bold text-white">
                    Submit the completed work
                  </h3>

                  <p className="mt-2 max-w-3xl leading-7 text-slate-400">
                    The builder submits delivery notes and one or more relevant
                    links. Depending on the project, these can point to a
                    GitHub repository, live deployment, Figma file, document,
                    video, or another agreed deliverable. The project USDC
                    remains secured in escrow during review.
                  </p>
                </div>
              </div>

              <Screenshot
                src="/13.png"
                alt="Submitting work through PayNode"
                caption="The builder records delivery information so the client can review the completed work."
              />
            </article>

            <article
              id="release-payment"
              className="scroll-mt-24 space-y-6"
            >
              <div className="flex items-start gap-4">
                <StepNumber number={5} />

                <div>
                  <h3 className="text-xl font-bold text-white">
                    Approve and release USDC
                  </h3>

                  <p className="mt-2 max-w-3xl leading-7 text-slate-400">
                    The client reviews the submitted delivery. The client can
                    request a revision when changes are needed or approve the
                    work. Approval triggers the settlement transaction and
                    transfers the escrowed USDC directly to the builder&apos;s
                    wallet.
                  </p>
                </div>
              </div>

              <Screenshot
                src="/16.png"
                alt="PayNode completed USDC payment"
                caption="After approval, the contract completes the project and transfers the escrowed USDC to the builder."
              />
            </article>

            <article id="rating" className="scroll-mt-24 space-y-6">
              <div className="flex items-start gap-4">
                <StepNumber number={6} />

                <div>
                  <h3 className="text-xl font-bold text-white">
                    Add a rating to the builder&apos;s reputation
                  </h3>

                  <p className="mt-2 max-w-3xl leading-7 text-slate-400">
                    After a successful USDC settlement, the client can leave a
                    star rating and review. The result becomes part of the
                    builder&apos;s professional history and helps future
                    clients evaluate previous work.
                  </p>
                </div>
              </div>

              <Screenshot
                src="/17.png"
                alt="PayNode client rating interface"
                caption="The client rates the completed project and contributes to the builder's PayNode reputation."
              />
            </article>
          </section>

          <section id="project-states" className="scroll-mt-24 space-y-8">
            <SectionHeading
              eyebrow="State machine"
              title="Every project has a clear on-chain state."
              description="The project state determines what each party can do and how the escrowed USDC is handled."
            />

            <div className="grid gap-4 md:grid-cols-2">
              {projectStates.map((item) => (
                <div
                  key={item.status}
                  className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5"
                >
                  <span
                    className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${item.color}`}
                  >
                    {item.status}
                  </span>

                  <p className="mt-4 text-sm leading-6 text-slate-400">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950 p-6">
              <div className="flex min-w-[760px] items-center justify-between gap-2">
                {[
                  "Awaiting USDC",
                  "USDC Funded",
                  "In Revision",
                  "Completed",
                ].map((state, index) => (
                  <div key={state} className="contents">
                    <div className="rounded-xl border border-slate-700 bg-slate-900 px-5 py-4 text-center text-sm font-semibold text-white">
                      {state}
                    </div>

                    {index < 3 && (
                      <div className="text-lg font-bold text-blue-400">→</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="smart-contract" className="scroll-mt-24 space-y-8">
            <SectionHeading
              eyebrow="Contract interface"
              title="Core USDC smart contract functions"
              description="PayNode uses an ERC-20 escrow contract. The client approves the exact USDC amount, the contract receives it through transferFrom(), and settlement uses USDC transfer() rather than native network value."
            />

            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#050810]">
              <div className="flex items-center gap-2 border-b border-slate-800 px-5 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />

                <span className="ml-2 text-xs text-slate-500">
                  PayNodeEscrow.sol
                </span>
              </div>

              <div className="divide-y divide-slate-800/80">
                {contractFunctions.map((item) => (
                  <div
                    key={item.name}
                    className="grid gap-3 p-5 md:grid-cols-[190px_minmax(0,1fr)]"
                  >
                    <code className="font-mono text-sm font-semibold text-blue-300">
                      {item.name}
                    </code>

                    <p className="text-sm leading-6 text-slate-400">
                      {item.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-5">
              <p className="text-sm font-semibold text-blue-200">
                USDC-only payment system
              </p>

              <p className="mt-2 text-sm leading-6 text-slate-400">
                PayNode does not accept native network tokens or arbitrary
                ERC-20 assets for project payments. Every project budget,
                escrow deposit, release, refund, and tip is denominated and
                settled exclusively in USDC.
              </p>
            </div>

            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
              <p className="text-sm font-semibold text-amber-200">
                Testnet notice
              </p>

              <p className="mt-2 text-sm leading-6 text-slate-400">
                PayNode is currently an MVP running on Arc Network Testnet.
                Testnet contracts and assets should not be treated as
                production-ready financial infrastructure until additional
                testing and an independent smart contract review are complete.
              </p>
            </div>
          </section>

          <section id="architecture" className="scroll-mt-24 space-y-8">
            <SectionHeading
              eyebrow="System design"
              title="Technical architecture"
              description="PayNode separates product metadata from critical USDC execution. The application database improves usability, while the smart contract remains the source of truth for escrow settlement."
            />

            <div className="rounded-3xl border border-slate-800 bg-slate-950 p-6 md:p-10">
              <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
                <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">
                    Interface
                  </p>

                  <h3 className="mt-2 font-bold text-white">Next.js App</h3>

                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    Profiles, dashboards, project forms, wallet actions, USDC
                    approvals, and delivery views.
                  </p>
                </div>

                <div className="flex items-center justify-center text-xl font-bold text-blue-400">
                  <span className="rotate-90 md:rotate-0">↔</span>
                </div>

                <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-violet-400">
                    Metadata
                  </p>

                  <h3 className="mt-2 font-bold text-white">Supabase</h3>

                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    User profiles, project descriptions, delivery links,
                    reviews, and synchronized blockchain IDs.
                  </p>
                </div>

                <div className="flex items-center justify-center text-xl font-bold text-blue-400">
                  <span className="rotate-90 md:rotate-0">↔</span>
                </div>

                <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-5 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                    USDC settlement
                  </p>

                  <h3 className="mt-2 font-bold text-white">
                    Arc Network Escrow Contract
                  </h3>

                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    USDC deposits, escrow balances, revisions, releases,
                    refunds, and dispute events.
                  </p>
                </div>
              </div>

              <div className="mt-4 flex justify-center">
                <div className="w-full rounded-2xl border border-blue-500/20 bg-blue-500/5 p-5 text-center md:w-2/3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">
                    Payment asset
                  </p>

                  <h3 className="mt-2 text-lg font-bold text-white">USDC</h3>

                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    The only supported asset for project escrow, settlement,
                    refunds, and tipping.
                  </p>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-slate-800 bg-[#090d16] p-5">
                <p className="text-sm leading-7 text-slate-400">
                  The frontend never assumes that a database row ID is the same
                  as an on-chain project ID. PayNode stores a dedicated{" "}
                  <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-blue-300">
                    blockchain_id
                  </code>{" "}
                  and uses it for every smart contract interaction.
                </p>
              </div>
            </div>
          </section>

          <section id="synchronization" className="scroll-mt-24 space-y-8">
            <SectionHeading
              eyebrow="Data integrity"
              title="Database and blockchain synchronization"
              description="A Web3 application can fail even when its contract and database work correctly on their own. The important part is keeping both systems mapped to the same USDC escrow project."
            />

            <div className="grid gap-4 md:grid-cols-3">
              {[
                {
                  number: "01",
                  title: "Submit transaction",
                  description:
                    "The client creates the project through the smart contract and waits for transaction confirmation.",
                },
                {
                  number: "02",
                  title: "Decode the event",
                  description:
                    "The application reads the ProjectCreated event and extracts the actual on-chain project ID.",
                },
                {
                  number: "03",
                  title: "Store the mapping",
                  description:
                    "The blockchain ID is saved beside the database record and used for all future USDC contract calls.",
                },
              ].map((item) => (
                <div
                  key={item.number}
                  className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6"
                >
                  <span className="text-xs font-bold text-blue-400">
                    {item.number}
                  </span>

                  <h3 className="mt-3 font-bold text-white">{item.title}</h3>

                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6">
              <pre className="overflow-x-auto text-sm leading-7 text-slate-300">
                <code>{`Database project ID:   project.id
Blockchain project ID: project.blockchain_id

UI routes use:          project.id
Contract functions use: project.blockchain_id`}</code>
              </pre>
            </div>
          </section>

          <section id="security" className="scroll-mt-24 space-y-8">
            <SectionHeading
              eyebrow="Security model"
              title="Designed to reduce unnecessary trust."
              description="PayNode limits wallet requests to actions that require authorization and keeps USDC payment rules inside the escrow contract."
            />

            <div className="grid gap-4 md:grid-cols-2">
              {securityItems.map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-bold text-emerald-400">
                      ✓
                    </span>

                    <div>
                      <h3 className="font-bold text-white">{item.title}</h3>

                      <p className="mt-2 text-sm leading-6 text-slate-400">
                        {item.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
              <h3 className="font-semibold text-red-200">
                PayNode will never ask for a seed phrase or private key.
              </h3>

              <p className="mt-2 text-sm leading-6 text-slate-400">
                Users should inspect every wallet request before signing,
                especially USDC approval transactions, and verify that they are
                connected to the official PayNode application and the expected
                Arc Network environment.
              </p>
            </div>
          </section>

          <section id="faq" className="scroll-mt-24 space-y-8">
            <SectionHeading
              eyebrow="Questions"
              title="Frequently asked questions"
              description="The main concepts behind PayNode, its USDC escrow workflow, and its current testnet release."
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

          <section className="overflow-hidden rounded-3xl border border-blue-500/25 bg-gradient-to-r from-blue-600/15 to-indigo-600/10 p-8 text-center md:p-12">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">
              PayNode on Arc Network
            </p>

            <h2 className="mt-4 text-3xl font-black tracking-tight text-white md:text-4xl">
              Negotiate anywhere. Get paid in USDC.
            </h2>

            <p className="mx-auto mt-4 max-w-2xl leading-7 text-slate-400">
              Explore the MVP, create a builder profile, and test a complete
              USDC escrow workflow on Arc Network Testnet.
            </p>

            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <a
                href="https://paynode.online"
                target="_blank"
                rel="noreferrer"
                className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-blue-500"
              >
                Open PayNode
              </a>

              <a
                href="https://github.com/padracrypto/PayNode"
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-slate-700 bg-slate-950/50 px-6 py-3 text-sm font-bold text-slate-200 transition hover:border-slate-600 hover:bg-slate-900"
              >
                Explore the code
              </a>
            </div>
          </section>

          <footer className="border-t border-slate-800 py-8">
            <div className="flex flex-col items-center justify-between gap-4 text-center md:flex-row md:text-left">
              <div>
                <p className="font-bold text-white">PayNode</p>

                <p className="mt-1 text-sm text-slate-500">
                  USDC escrow and reputation infrastructure for Web3
                  collaboration.
                </p>
              </div>

              <div className="text-sm text-slate-500">
                Built on Arc Network. Powered by USDC. Made for builders.
              </div>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}