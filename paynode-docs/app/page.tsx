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
    title: "Dispute Resolution",
    items: [
      { title: "How Disputes Work", href: "#disputes" },
      { title: "Resolution Paths", href: "#resolution-paths" },
      { title: "AI Resolver", href: "#ai-resolver" },
      { title: "Attestation Flow", href: "#attestation" },
      { title: "Resolver Security", href: "#resolver-security" },
      { title: "Timelocks & Breakers", href: "#timelocks" },
      { title: "Evidence & Deliverables", href: "#evidence" },
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

const deployments = [
  {
    network: "Mainnet",
    chainId: 5042,
    address: "0xDC3B4bE2AfD7b7A6f03E4F41379d6378451C1910",
    explorer: "https://arc.etherscan.io/address/",
  },
  {
    network: "Testnet",
    chainId: 5042002,
    address: "0x61F0530ae40b3EEbD4eB76c5A0977827BE7CB10e",
    explorer: "https://explorer.testnet.arc.io/address/",
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

const resolutionPathCards = [
  {
    letter: "A",
    badge: "Default",
    badgeClass: "border-blue-500/25 bg-blue-500/10 text-blue-300",
    title: "Autonomous AI Resolver",
    contract: "resolveDisputeWithAttestation",
    contractPath: "Contract path 2",
    summary:
      "Gemini reads the brief, every deliverable on record, the verified on-chain timeline, and both parties' statements, then divides the escrow anywhere from 0% to 100% to the builder. The ruling is signed as an EIP-712 attestation and executed on-chain.",
    facts: [
      [
        "Applies when",
        "No arbitrator was named at creation, and the resolver epoch snapshotted at funding has a non-zero signing key.",
      ],
      [
        "Who starts it",
        "Either party, once both have filed a statement or the 72-hour evidence window has passed.",
      ],
      [
        "How binding",
        "One ruling per project, final, with no appeal. Anyone can relay the signed ruling to the contract.",
      ],
    ],
  },
  {
    letter: "B",
    badge: "Always available",
    badgeClass:
      "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    title: "Mutual Direct Settlement",
    contract: "proposeSettlement / acceptSettlement",
    contractPath: "Contract path 3",
    summary:
      "One party proposes a percentage split on-chain and the other accepts it. No arbitrator, no AI, no waiting period. The escrow pays out in the same transaction as the acceptance.",
    facts: [
      [
        "Applies when",
        "Any funded stage (Funded, InRevision, Delivered, or Disputed), on every project.",
      ],
      [
        "Who starts it",
        "Either party, at any time until the escrow settles by any path, including while a ruling is being prepared.",
      ],
      [
        "How binding",
        "Needs both parties. An offer binds nobody until it is accepted and can be withdrawn until then.",
      ],
    ],
  },
  {
    letter: "C",
    badge: "Optional",
    badgeClass:
      "border-violet-500/25 bg-violet-500/10 text-violet-300",
    title: "Named Arbitrator",
    contract: "resolveDispute",
    contractPath: "Contract path 1",
    summary:
      "A third-party wallet, designated by the client when the project is created, reads the case and rules: release to the builder, refund the client, or any split between the two.",
    facts: [
      [
        "Applies when",
        "An arbitrator address was passed to createProject. It cannot be added, changed, or removed later.",
      ],
      [
        "Who starts it",
        "Only the arbitrator. Neither party can trigger or hurry a ruling.",
      ],
      [
        "How binding",
        "Pays out as soon as the arbitrator submits it. Cannot be revised or appealed.",
      ],
    ],
  },
];

const resolverPipeline = [
  {
    title: "Request",
    body: "A party calls POST /api/dispute/request-resolution with their SIWE session. The route admits only the project's client or builder, and enforces the evidence window. Operators and cron jobs use POST /api/dispute/resolve, authenticated with a server-side secret that never reaches a browser.",
  },
  {
    title: "Chain preflight",
    body: "Before any model call, the resolver reads the contract: the project must exist, be Disputed, have no designated arbitrator, and have a non-zero key for its resolver epoch that matches the key this service signs with. Eligibility is never decided from the database.",
  },
  {
    title: "Claim the ruling slot",
    body: "A pending row is inserted into the ruling ledger, keyed uniquely on the on-chain project id. Of two concurrent requests, exactly one wins the insert. The loser, and every later request, is served the winner's result.",
  },
  {
    title: "Assemble the case file",
    body: "Verified on-chain facts, the agreed scope, the builder's submissions, and each party's statements are rendered in a fixed order inside fenced sections. The client's section always comes first, regardless of who raised the dispute.",
  },
  {
    title: "Adjudicate",
    body: "Gemini evaluates the case under a frozen rubric supplied as the system instruction, and returns a schema-constrained JSON ruling.",
  },
  {
    title: "Validate and sign",
    body: "builderBps is re-checked to be an integer in 0–10,000. Out-of-range values are rejected, never clamped. The ruling is signed as an EIP-712 attestation and checked against the contract's own digest before it is stored.",
  },
  {
    title: "Store, notify, relay",
    body: "The ruling, reasoning, full evidence analysis, signature, model version, and token usage are written to the ledger. Both parties are notified, and either of them (or anyone else) submits the attestation on-chain.",
  },
];

const rulingOutcomes = [
  [
    "signed",
    "Attestation issued and stored. Every later request replays this exact signature.",
  ],
  [
    "pending",
    "Another request is mid-arbitration. The caller receives HTTP 202 and polls.",
  ],
  [
    "failed",
    "The model refused to rule (safety block or refusal finish reason). Terminal for Path A. Path B and the 30-day breaker remain open.",
  ],
  [
    "ineligible",
    "A preflight gate refused: not disputed, arbitrator assigned, resolver disabled, or epoch mismatch. Not persisted, so the project's ruling slot is not consumed.",
  ],
  [
    "transient error",
    "RPC failure, rate limit, or a ruling truncated at the output budget. The claim is released and the request can be retried.",
  ],
];

const resolverSecurity = [
  {
    title: "Prompt injection defense",
    accent: "text-blue-400",
    points: [
      "The adjudication rubric is sent as Gemini's system instruction, a separate channel from the party-written case file. It is never concatenated with evidence.",
      "Every party-supplied string is placed inside a named section (agreed_scope, builder_submissions, client_statement, builder_statement). The rubric declares those sections to be evidence with no authority over the ruling.",
      "Text that tries to instruct the resolver, claim to come from PayNode, or dictate an outcome is treated as a manipulation attempt. It is flagged (manipulationDetected) and weighed against that party under the good-faith criterion.",
    ],
  },
  {
    title: "Evidence sanitization",
    accent: "text-emerald-400",
    points: [
      "< and > in party text are escaped before rendering, so a statement cannot close its section early and forge a new one.",
      "Links must be http(s), with at most 10 per submission and 2,048 characters each. The resolver never opens links. A URL is treated as a claim that something exists at that address, not as proof of delivery.",
      "Facts about money, deadlines, revisions, and status come from the contract, not the database. When a statement contradicts them, the chain wins.",
    ],
  },
  {
    title: "Token budgeting",
    accent: "text-amber-400",
    points: [
      "Each free-text field is capped at 20,000 characters, both in the submission form and when the case file is rendered, so one party cannot bury the other's argument or overflow the context window.",
      "Output is budgeted at 16,000 tokens, covering high-level thinking, the evidence analysis, and the reasoning. A ruling truncated at that limit is rejected rather than signed.",
      "Input, output, and thinking tokens are recorded with every ruling for provenance and cost auditing.",
    ],
  },
  {
    title: "Verdict manipulation resistance",
    accent: "text-violet-400",
    points: [
      "One ruling per project, ever. The ledger's unique key is claimed before the model is called, so re-requesting returns the original signature byte for byte. A ruling cannot be re-rolled.",
      "Parties cannot write to the ruling ledger, and a pending ruling is hidden from them by row-level security, so it gives no signal to tamper with evidence mid-arbitration.",
      "The 72-hour evidence window prevents the first party to file from having the case decided before the other side has answered.",
      "Temperature 0, a fixed seed, and a fixed evidence order minimize run-to-run variance. Because a ruling cannot be re-rolled, any variance that remains cannot be exploited.",
    ],
  },
  {
    title: "Signing key hygiene",
    accent: "text-rose-400",
    points: [
      "The resolver key only signs. It never sends transactions and holds no balance, so a relayer, not the resolver, pays gas.",
      "Deployments pin the expected signer address and refuse to start on a mismatched key.",
      "Every signature is checked against the contract's resolutionDigest view before it is issued, which catches chain-id or contract-address drift before a party receives an attestation that would revert.",
    ],
  },
  {
    title: "Safety filters without dead ends",
    accent: "text-sky-400",
    points: [
      "Disputes often quote hostile language as evidence, so Gemini's safety thresholds are set to BLOCK_ONLY_HIGH rather than the default. That is one notch looser than the default, and never off.",
      "A genuine refusal is recorded as a terminal failed ruling instead of being retried. The dispute then proceeds through mutual settlement or the 30-day breaker.",
    ],
  },
];

const protocolClocks = [
  {
    name: "Review period",
    duration: "7 days",
    scope: "On-chain · REVIEW_PERIOD",
    description:
      "Starts at each delivery. If the client does not approve, request a revision, or dispute before it ends, the builder can claim the escrow.",
  },
  {
    name: "Revision grace",
    duration: "7 days",
    scope: "On-chain · REVISION_GRACE",
    description:
      "Each revision request extends the delivery deadline to at least 7 days from now, so asking for more work always grants time to do it.",
  },
  {
    name: "Evidence window",
    duration: "72 hours",
    scope: "Off-chain · resolver API",
    description:
      "Minimum time after a dispute is raised before an AI ruling can be requested, unless both parties have already filed a statement.",
  },
  {
    name: "Attestation validity",
    duration: "7 days",
    scope: "Signed deadline field",
    description:
      "A signed ruling must be submitted before its deadline or the contract rejects it with AttestationExpired.",
  },
  {
    name: "Resolver timelock",
    duration: "7 days",
    scope: "On-chain · RESOLVER_TIMELOCK",
    description:
      "Mandatory public notice between announcing and applying a resolver signing-key rotation.",
  },
  {
    name: "Dispute timeout",
    duration: "30 days",
    scope: "On-chain · DISPUTE_TIMEOUT",
    description:
      "After this, anyone can settle the dispute with forceResolveStaleDispute on the contract's fixed terms.",
  },
];

const deliverableLifecycle = [
  {
    title: "Record the deliverable",
    body: "The builder submits a title, a description, and up to 10 artifact links. The row is written before the on-chain transaction, so the chain can never say Delivered with nothing behind it.",
  },
  {
    title: "Mark delivered on-chain",
    body: "The builder calls markDelivered, which starts the 7-day review period. It reverts once the delivery deadline has passed. Retrying after a rejected wallet prompt reuses the recorded row instead of creating a duplicate.",
  },
  {
    title: "Revise",
    body: "A client revision request increments revisionsUsed on-chain. The builder's next submission is recorded with revision_index equal to that on-chain counter, so the database cannot disagree with the contract's timeline.",
  },
  {
    title: "Evidence in a dispute",
    body: "Every submission, in every revision round, appears in the resolver's case file in chronological order. Earlier rounds are never replaced.",
  },
];

const securityRules = [
  "The builder cannot receive the project payment before submitting work.",
  "The client cannot keep a completed delivery unpaid forever.",
  "The client can refund after the project deadline if no delivery exists.",
  "The payment remains locked while a revision is active.",
  "Every revised delivery starts a new 7-day review period.",
  "Project payments, refunds, settlements, and tips use USDC only.",
  "Every dispute ends: after 30 days, anyone can trigger the contract's fixed settlement.",
  "The platform owner cannot resolve disputes, move escrowed funds, or change a funded project's resolver.",
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
    question: "Who decides a dispute on my project?",
    answer:
      "It is fixed before the dispute exists. If the client named an arbitrator when creating the project, that wallet decides. Otherwise the autonomous AI resolver decides, provided a resolver key was active when the project was funded. In every case, both parties can settle directly by mutual agreement at any time.",
  },
  {
    question: "Can I appeal or re-request an AI ruling?",
    answer:
      "No. Each project receives exactly one ruling. Requesting again returns the same signed ruling, and the contract accepts it only once. If you both prefer a different outcome, you can still agree a split through mutual settlement before the ruling is executed on-chain.",
  },
  {
    question: "What if the AI resolver declines to rule, or nobody submits the ruling?",
    answer:
      "A refusal is final for the AI path, and an unsubmitted ruling expires 7 days after it is signed. Either way, the dispute stays open to mutual settlement, and after 30 days anyone can trigger the contract's fixed outcome: 50/50 if the work had been delivered, or a full refund to the client if it had not.",
  },
  {
    question: "Can PayNode change the outcome of a dispute?",
    answer:
      "No. The platform owner has no dispute or fund-moving powers in the contract. The owner can rotate the AI resolver's signing key only after a public 7-day timelock, and a rotation applies only to projects funded after it takes effect.",
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

function CodeBlock({
  label,
  children,
}: {
  label: string;
  children: string;
}) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
      <figcaption className="border-b border-slate-800 px-5 py-2.5 font-mono text-xs text-slate-500">
        {label}
      </figcaption>

      <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-6 text-slate-300">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code className="rounded-md border border-slate-800 bg-slate-900 px-1.5 py-0.5 font-mono text-[0.85em] text-blue-200">
      {children}
    </code>
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
                Arc Network
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

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                PayNodeEscrowV2
              </p>

              <ul className="mt-3 space-y-3">
                {deployments.map((d) => (
                  <li key={d.network}>
                    <p className="text-sm font-medium text-white">
                      {d.network}
                      <span className="ml-2 font-mono text-[10px] text-slate-500">
                        chain {d.chainId}
                      </span>
                    </p>

                    <a
                      href={`${d.explorer}${d.address}`}
                      target="_blank"
                      rel="noreferrer"
                      title={d.address}
                      className="mt-1 block font-mono text-xs text-blue-300 transition hover:text-blue-200"
                    >
                      {d.address.slice(0, 8)}…{d.address.slice(-6)}
                    </a>
                  </li>
                ))}
              </ul>
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
            id="disputes"
            className="scroll-mt-24 space-y-8"
          >
            <SectionHeading
              eyebrow="Dispute resolution"
              title="A dispute pauses the clock. It never freezes the funds."
              description="Raising a dispute moves the project to Disputed and suspends the review period. From there, funds leave escrow through one of three resolution paths, or, if nobody acts for 30 days, through a permissionless circuit breaker. The contract has no reachable state that holds funds indefinitely."
            />

            <div className="grid gap-4 md:grid-cols-2">
              <article className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-6">
                <span className="inline-flex rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-300">
                  Client
                </span>

                <h3 className="mt-5 text-lg font-bold text-white">
                  Can dispute only after a delivery.
                </h3>

                <p className="mt-3 text-sm leading-7 text-slate-400">
                  The client may call <Code>raiseDispute</Code> only
                  while the project is <Code>Delivered</Code>. A stale
                  dispute over undelivered work refunds the client in
                  full, so allowing earlier disputes would let a client
                  freeze a builder on day one and reclaim the escrow
                  while work was still in progress.
                </p>
              </article>

              <article className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
                <span className="inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                  Builder
                </span>

                <h3 className="mt-5 text-lg font-bold text-white">
                  Can dispute at any funded stage.
                </h3>

                <p className="mt-3 text-sm leading-7 text-slate-400">
                  From <Code>Funded</Code>, <Code>InRevision</Code>, or{" "}
                  <Code>Delivered</Code>. This lets a builder put an
                  unresponsive client in front of an adjudicator and be
                  awarded partial payment for work performed. It cannot
                  be abused, because every pre-delivery stale outcome
                  favours the client.
                </p>
              </article>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-800">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold">
                      Resolution
                    </th>
                    <th className="px-5 py-3 font-semibold">
                      Contract function
                    </th>
                    <th className="px-5 py-3 font-semibold">
                      DisputeResolved.resolutionPath
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {[
                    ["Path C · Named arbitrator", "resolveDispute", "0"],
                    [
                      "Path A · AI resolver",
                      "resolveDisputeWithAttestation",
                      "1",
                    ],
                    [
                      "Path B · Mutual settlement",
                      "acceptSettlement",
                      "2",
                    ],
                    [
                      "Stale-dispute breaker",
                      "forceResolveStaleDispute",
                      "3",
                    ],
                  ].map(([name, fn, id]) => (
                    <tr key={fn}>
                      <td className="px-5 py-3 font-medium text-white">
                        {name}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-blue-200">
                        {fn}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-400">
                        {id}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-sm leading-7 text-slate-400">
              Every path settles through the same internal function. The
              builder&apos;s share is paid net of the protocol fee
              snapshotted when the project was funded, the remainder is
              refunded to the client with no fee, and any pending
              settlement offer is cleared. A project that settles
              reaches a terminal status and can never be disputed or
              resolved again.
            </p>
          </section>

          <section
            id="resolution-paths"
            className="scroll-mt-24 space-y-8"
          >
            <SectionHeading
              eyebrow="Three ways out"
              title="The three dispute resolution paths"
              description="Which paths are open is a property of the project, fixed before any dispute exists. Path A and Path C are mutually exclusive: every project has exactly one adjudicator. Path B is open on every project."
            />

            <div className="grid gap-4 xl:grid-cols-3">
              {resolutionPathCards.map((path) => (
                <article
                  key={path.letter}
                  className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/40 p-6"
                >
                  <div className="flex items-center justify-between gap-4">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-sm font-black text-white">
                      {path.letter}
                    </span>

                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${path.badgeClass}`}
                    >
                      {path.badge}
                    </span>
                  </div>

                  <h3 className="mt-5 text-lg font-bold text-white">
                    Path {path.letter}: {path.title}
                  </h3>

                  <p className="mt-1 font-mono text-xs text-slate-500">
                    {path.contractPath} · {path.contract}
                  </p>

                  <p className="mt-4 text-sm leading-7 text-slate-400">
                    {path.summary}
                  </p>

                  <dl className="mt-5 space-y-3 border-t border-slate-800 pt-5">
                    {path.facts.map(([term, detail]) => (
                      <div key={term}>
                        <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          {term}
                        </dt>
                        <dd className="mt-1 text-sm leading-6 text-slate-300">
                          {detail}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6">
                <h3 className="font-bold text-white">
                  Mutual settlement mechanics
                </h3>

                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-400">
                  <li>
                    <Code>proposeSettlement(projectId, builderBps)</Code>{" "}
                    records an offer. A new proposal overwrites the
                    previous one.
                  </li>
                  <li>
                    <Code>withdrawSettlement(projectId)</Code> retracts
                    it. Only the proposer can withdraw.
                  </li>
                  <li>
                    <Code>acceptSettlement(projectId, builderBps)</Code>{" "}
                    must be called by the counterparty and must restate
                    the exact split. If the proposer changed the terms
                    in the meantime, the acceptance reverts with{" "}
                    <Code>SettlementMismatch</Code> instead of binding
                    the accepter to terms they never saw.
                  </li>
                </ul>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6">
                <h3 className="font-bold text-white">
                  Choosing an adjudicator
                </h3>

                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-400">
                  <li>
                    Path A is the default: the project creation form
                    passes the zero address as the arbitrator.
                  </li>
                  <li>
                    A named arbitrator cannot be the client or the
                    builder, and is permanent for the life of the
                    project.
                  </li>
                  <li>
                    The client chooses the arbitrator on their own.
                    A builder who does not accept that choice can call{" "}
                    <Code>builderCancel</Code> at any funded stage to
                    return 100% to the client, so builders should check
                    the arbitrator before starting work.
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <section
            id="ai-resolver"
            className="scroll-mt-24 space-y-8"
          >
            <SectionHeading
              eyebrow="Path A · Gemini engine"
              title="Autonomous AI dispute resolution"
              description="Disputes on the default path are adjudicated by Google Gemini (gemini-3.5-flash) against a frozen, versioned rubric, with a JSON-Schema-constrained response. The resolver never moves funds itself: it produces a signed ruling that the contract verifies and executes."
            />

            <ol className="space-y-3">
              {resolverPipeline.map((step, index) => (
                <li
                  key={step.title}
                  className="flex items-start gap-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-5"
                >
                  <StepNumber number={index + 1} />

                  <div>
                    <h3 className="font-bold text-white">
                      {step.title}
                    </h3>
                    <p className="mt-1 text-sm leading-7 text-slate-400">
                      {step.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6">
                <h3 className="font-bold text-white">
                  Adjudication standard
                </h3>

                <p className="mt-2 text-sm leading-6 text-slate-400">
                  The resolver rules on the balance of probabilities,
                  against the agreed scope, weighing in order:
                </p>

                <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-slate-300">
                  <li>Delivery against scope</li>
                  <li>
                    The verified on-chain timeline, which overrides any
                    conflicting statement
                  </li>
                  <li>
                    Burden of proof: the builder evidences delivery,
                    the client evidences deficiency
                  </li>
                  <li>
                    Scope discipline: requirements first raised in the
                    dispute are not part of the agreement
                  </li>
                  <li>Good faith</li>
                </ol>

                <p className="mt-3 text-sm leading-6 text-slate-400">
                  Splits are rounded to the nearest 250 bps (2.5%) unless
                  the evidence justifies a specific figure. A party who
                  files no statement does not automatically lose.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6">
                <h3 className="font-bold text-white">
                  Generation settings
                </h3>

                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  {[
                    ["model", "gemini-3.5-flash (pinned version, never an alias)"],
                    ["systemInstruction", "frozen rubric, no interpolated values"],
                    ["temperature", "0"],
                    ["seed", "fixed"],
                    ["thinkingLevel", "high"],
                    ["responseMimeType", "application/json"],
                    ["responseJsonSchema", "strict ruling schema"],
                    ["maxOutputTokens", "16,000"],
                  ].map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="font-mono text-xs leading-6 text-blue-200">
                        {key}
                      </dt>
                      <dd className="leading-6 text-slate-400">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>

            <CodeBlock label="Ruling schema (abridged) · additionalProperties: false, all fields required">
              {`{
  "evidenceAnalysis": [
    {
      "source": "agreed_scope" | "verified_facts" | "builder_submissions"
              | "client_statement" | "builder_statement",
      "finding": string,
      "weighsToward": "client" | "builder" | "neither",
      "weight": "decisive" | "strong" | "moderate" | "slight"
    }
  ],
  "reasoning": string,             // 4–8 sentences, shown to both parties
  "manipulationDetected": boolean,
  "confidence": "low" | "medium" | "high",
  "builderBps": integer            // 0–10000, emitted last
}`}
            </CodeBlock>

            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6">
              <h3 className="font-semibold text-amber-200">
                On determinism
              </h3>

              <p className="mt-2 text-sm leading-7 text-slate-400">
                The output shape is fully deterministic: the schema
                constrains every field. The verdict itself is pinned as
                far as the provider allows (temperature 0, fixed seed,
                fixed evidence order), but identical inputs can still
                diverge occasionally across a serving fleet. The
                guarantee PayNode relies on is structural instead:{" "}
                <span className="text-slate-200">
                  one ruling per project, ever
                </span>
                . Run-to-run variance cannot be exploited when no party
                can request a second run. The <Code>builderBps</Code>{" "}
                field is emitted last so the split is a conclusion
                drawn from the analysis above it, not a number the
                reasoning is written to justify.
              </p>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-800">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Outcome</th>
                    <th className="px-5 py-3 font-semibold">Meaning</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-800">
                  {rulingOutcomes.map(([outcome, meaning]) => (
                    <tr key={outcome}>
                      <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-blue-200">
                        {outcome}
                      </td>
                      <td className="px-5 py-3 leading-6 text-slate-400">
                        {meaning}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section
            id="attestation"
            className="scroll-mt-24 space-y-8"
          >
            <SectionHeading
              eyebrow="Cryptographic flow"
              title="From AI evaluation to on-chain execution"
              description="A ruling becomes enforceable only as an EIP-712 structured signature from the resolver key that governs the project's epoch. The contract verifies that signature itself. It does not trust the API, the database, or the party who submits it."
            />

            <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-5 md:p-8">
              <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
                {[
                  ["AI evaluation", "Gemini returns builderBps"],
                  ["EIP-712 attestation", "Resolver key signs the ruling"],
                  ["On-chain execution", "resolveDisputeWithAttestation"],
                ].map(([title, detail], index) => (
                  <div key={title} className="contents">
                    <div className="flex min-h-24 flex-col justify-center rounded-xl border border-slate-800 bg-slate-900/80 p-4 text-center">
                      <span className="text-sm font-bold text-white">
                        {title}
                      </span>
                      <span className="mt-1 font-mono text-xs text-slate-400">
                        {detail}
                      </span>
                    </div>

                    {index < 2 && (
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

            <div className="grid gap-4 lg:grid-cols-2">
              <CodeBlock label="EIP-712 typed data">
                {`domain: {
  name: "PayNodeEscrow",
  version: "2",
  chainId,              // Arc network chain id
  verifyingContract     // PayNodeEscrowV2 address
}

Resolution(
  uint256 projectId,    // on-chain project id
  uint16  builderBps,   // 0–10000
  uint256 deadline      // unix seconds; signing time + 7 days
)`}
              </CodeBlock>

              <CodeBlock label="Execution · callable by any address">
                {`function resolveDisputeWithAttestation(
  uint256 projectId,
  uint16  builderBps,
  uint256 deadline,
  bytes   calldata signature
) external;

// Helper views
resolutionDigest(projectId, builderBps, deadline) → bytes32
resolverFor(projectId) → address  // key for the project's epoch`}
              </CodeBlock>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6">
                <h3 className="font-bold text-white">
                  Before the signature is issued
                </h3>

                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-400">
                  <li>
                    <Code>builderBps</Code> is re-validated as an
                    integer in 0–10,000. Out-of-range values are
                    rejected, never clamped.
                  </li>
                  <li>
                    The signature is recovered locally and must match
                    the resolver address.
                  </li>
                  <li>
                    The locally computed digest must equal the
                    contract&apos;s <Code>resolutionDigest</Code>. This
                    catches a wrong chain id or contract address before
                    a party is handed an attestation that would revert.
                  </li>
                </ol>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6">
                <h3 className="font-bold text-white">
                  What the contract checks
                </h3>

                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-400">
                  <li>
                    No designated arbitrator →{" "}
                    <Code>ArbitratorAssigned</Code>
                  </li>
                  <li>
                    <Code>block.timestamp</Code> is not past the
                    deadline → <Code>AttestationExpired</Code>
                  </li>
                  <li>
                    <Code>builderBps</Code> is at most 10,000 →{" "}
                    <Code>BpsTooHigh</Code>
                  </li>
                  <li>
                    Project is <Code>Disputed</Code> →{" "}
                    <Code>BadState</Code>
                  </li>
                  <li>
                    The project&apos;s epoch has a key →{" "}
                    <Code>ResolverDisabled</Code>
                  </li>
                  <li>
                    Signature recovers to{" "}
                    <Code>resolverAt[p.resolverEpoch]</Code> →{" "}
                    <Code>BadAttestation</Code>
                  </li>
                </ul>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {[
                [
                  "Replay-proof by construction",
                  "Settlement moves the project to a terminal status that can never return to Disputed, so a project can be resolved at most once. No nonce is needed.",
                ],
                [
                  "Gasless for the parties",
                  "The attestation can be relayed by any address, so neither party needs the resolver to hold gas. The resolver key never transacts and holds no balance.",
                ],
                [
                  "Bounded lifetime",
                  "The signed deadline gives a ruling 7 days to be submitted. An expired ruling is not re-issued. The dispute continues through Path B or the 30-day breaker.",
                ],
              ].map(([title, body]) => (
                <div
                  key={title}
                  className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5"
                >
                  <h3 className="font-semibold text-white">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {body}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section
            id="resolver-security"
            className="scroll-mt-24 space-y-8"
          >
            <SectionHeading
              eyebrow="Security model"
              title="Built for adversarial evidence."
              description="Both parties write text that the model reads, and both have a financial incentive to influence the ruling. The resolver assumes every statement may contain an attack and is designed so that none can change who wins."
            />

            <div className="grid gap-4 md:grid-cols-2">
              {resolverSecurity.map((group) => (
                <article
                  key={group.title}
                  className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6"
                >
                  <h3
                    className={`text-xs font-semibold uppercase tracking-wider ${group.accent}`}
                  >
                    {group.title}
                  </h3>

                  <ul className="mt-4 space-y-3">
                    {group.points.map((point) => (
                      <li
                        key={point}
                        className="flex items-start gap-3 text-sm leading-6 text-slate-300"
                      >
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-600" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <section
            id="timelocks"
            className="scroll-mt-24 space-y-8"
          >
            <SectionHeading
              eyebrow="Timelocks, lifecycles & fallback breakers"
              title="Every clock that governs a dispute"
              description="Several of these are 7 days long but control different things. Durations marked on-chain are bytecode constants that no owner can change."
            />

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {protocolClocks.map((clock) => (
                <div
                  key={clock.name}
                  className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-bold text-white">
                      {clock.name}
                    </h3>
                    <span className="text-lg font-black text-blue-300">
                      {clock.duration}
                    </span>
                  </div>

                  <p className="mt-1 font-mono text-[11px] text-slate-500">
                    {clock.scope}
                  </p>

                  <p className="mt-3 text-sm leading-6 text-slate-400">
                    {clock.description}
                  </p>
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <h3 className="text-xl font-bold text-white">
                Resolver key rotation and epoch snapshots
              </h3>

              <p className="max-w-3xl text-sm leading-7 text-slate-400">
                The AI resolver&apos;s signing key is versioned by{" "}
                <Code>resolverEpoch</Code>. Rotating it is a two-step,
                publicly announced process, and a rotation never reaches
                back into escrow that is already locked.
              </p>

              <CodeBlock label="Rotation · owner only">
                {`initiateResolverUpdate(newSigner)
  → emits ResolverUpdateInitiated(newSigner, eta)   // eta = now + 7 days
  → calling again replaces the pending key and restarts the clock
  → cancelResolverUpdate() abandons it

applyResolverUpdate()                                // reverts ResolverTimelockActive before eta
  → resolverEpoch += 1
  → resolverAt[resolverEpoch] = newSigner
  → emits ResolverUpdated(newEpoch, oldSigner, newSigner)

fundProject(projectId)
  → p.resolverEpoch = resolverEpoch                  // snapshotted at funding`}
              </CodeBlock>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5 text-sm leading-6 text-slate-400">
                  <h4 className="font-semibold text-white">
                    Why snapshot, not just timelock
                  </h4>
                  <p className="mt-2">
                    A client whose project is mid-dispute cannot
                    unilaterally exit during a 7-day notice window, so
                    the notice alone would not protect them. Pinning each
                    project to the key that was live when the client
                    funded it means already-locked escrow is always
                    settled by the key the client agreed to.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5 text-sm leading-6 text-slate-400">
                  <h4 className="font-semibold text-white">
                    Disabling Path A
                  </h4>
                  <p className="mt-2">
                    Rotating to the zero address retires the AI
                    resolver for projects funded afterwards. A project
                    whose epoch has no key simply has Path A closed;
                    Path B and the 30-day breaker are unaffected. Check a
                    specific project with <Code>resolverFor(projectId)</Code>.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-xl font-bold text-white">
                30-day stale dispute circuit breaker
              </h3>

              <p className="max-w-3xl text-sm leading-7 text-slate-400">
                <Code>forceResolveStaleDispute(projectId)</Code> needs no
                arbitrator, no resolver key, no owner, and no cooperation
                from either party. Once 30 days have passed since the
                dispute was raised, any address, including a keeper bot,
                can call it. Read the unlock time with{" "}
                <Code>staleResolvableAt(projectId)</Code>.
              </p>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">
                    Work was delivered
                  </p>
                  <h4 className="mt-3 text-2xl font-black text-white">
                    50 / 50 split
                  </h4>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    If the project was <Code>Delivered</Code> when the
                    dispute was raised, the builder receives 5,000 bps
                    (net of the project&apos;s fee) and the client is
                    refunded the rest.
                  </p>
                </div>

                <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-6">
                  <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">
                    No work on record
                  </p>
                  <h4 className="mt-3 text-2xl font-black text-white">
                    100% refund to client
                  </h4>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    If the dispute was raised from <Code>Funded</Code>{" "}
                    or <Code>InRevision</Code>, the whole escrow returns
                    to the client.
                  </p>
                </div>
              </div>

              <p className="max-w-3xl text-sm leading-7 text-slate-500">
                “Delivered” means the on-chain status captured by{" "}
                <Code>raiseDispute</Code> (<Code>preDispute</Code>),
                which is set only by <Code>markDelivered</Code>.
                Deliverable records in the database do not affect this
                outcome. Pausing the contract does not block the
                breaker: a pause affects only new projects and new
                funding.
              </p>
            </div>
          </section>

          <section
            id="evidence"
            className="scroll-mt-24 space-y-8"
          >
            <SectionHeading
              eyebrow="Claim Center"
              title="Evidence and the deliverable lifecycle"
              description="Deliverables and dispute statements are evidence, not state. Only contract calls move a project. The evidence record is append-only, so what the resolver reads is exactly what each party put on the record, when they put it there."
            />

            <ol className="grid gap-4 md:grid-cols-2">
              {deliverableLifecycle.map((step, index) => (
                <li
                  key={step.title}
                  className="flex items-start gap-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-5"
                >
                  <StepNumber number={index + 1} />

                  <div>
                    <h3 className="font-bold text-white">
                      {step.title}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-slate-400">
                      {step.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6">
                <h3 className="font-bold text-white">
                  The 72-hour evidence window
                </h3>

                <p className="mt-2 text-sm leading-6 text-slate-400">
                  After a dispute is raised, both parties file
                  statements in the Claim Center, each up to 20,000
                  characters with up to 10 supporting links. An AI
                  ruling can be requested once{" "}
                  <span className="text-slate-200">
                    both parties have filed
                  </span>{" "}
                  or{" "}
                  <span className="text-slate-200">
                    72 hours have passed
                  </span>{" "}
                  since the dispute was raised, whichever comes first.
                  Until then, a request returns <Code>too_early</Code>{" "}
                  with the remaining time.
                </p>

                <p className="mt-3 text-sm leading-6 text-slate-400">
                  The window is measured against block time, the same
                  clock the contract uses, and is enforced by the server
                  rather than the browser. It is a minimum wait, not a
                  cutoff: parties can keep filing until a ruling is
                  issued.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6">
                <h3 className="font-bold text-white">
                  Immutability of the record
                </h3>

                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-400">
                  <li>
                    Row-level security grants parties insert access
                    only. There is no update or delete policy, so filed
                    statements and deliverables cannot be edited or
                    withdrawn.
                  </li>
                  <li>
                    Timestamps are set by the database. Parties cannot
                    write <Code>created_at</Code>, so nothing can be
                    backdated.
                  </li>
                  <li>
                    Only the builder can record deliverables, and each
                    statement&apos;s role must match the author&apos;s
                    side. A client cannot file as the builder.
                  </li>
                  <li>
                    Evidence is visible to the client, the builder, and
                    any designated arbitrator. It is visible to the other
                    party as soon as it is filed.
                  </li>
                </ul>
              </div>
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