import { readFile, writeFile } from "node:fs/promises";
const logos = JSON.parse(
  await readFile(
    new URL("../apps/api/assets/company-logos/sources.json", import.meta.url),
    "utf8",
  ),
);
const profiles = {
  TCS: [
    "IT services and delivery",
    [
      [
        "How would you find the second-largest distinct number in an array in one pass?",
        "Track the largest and second-largest distinct values while scanning. Ignore duplicates. This uses O(n) time and O(1) extra space.",
      ],
      [
        "What is the difference between a primary key and a foreign key?",
        "A primary key uniquely identifies a row. A foreign key references a key in another table and enforces referential integrity.",
      ],
      [
        "A client changes a requirement near a deadline. How would you respond?",
        "Clarify the change, assess impact, agree on priorities and document a revised plan with the team and client.",
      ],
    ],
  ],
  Infosys: [
    "software fundamentals",
    [
      [
        "Explain encapsulation with a bank-account example.",
        "Keep the balance private and expose deposit and withdrawal methods that validate inputs and enforce balance rules.",
      ],
      [
        "What makes a database table reach second normal form?",
        "It must be in first normal form, and every non-key attribute must depend on the whole of each candidate key, not only part of a composite key.",
      ],
      [
        "How would you explain a technical delay to a client?",
        "Describe the impact in plain language, explain what is known, propose alternatives and agree on a realistic next update.",
      ],
    ],
  ],
  Wipro: [
    "testing and application support",
    [
      [
        "How do unit tests differ from integration tests?",
        "Unit tests isolate a small unit of behavior. Integration tests check that multiple components interact correctly.",
      ],
      [
        "A service is slow but returns no errors. What would you check first?",
        "Measure request timings, resource use, database query duration and downstream dependencies. Use traces or logs to identify the bottleneck before changing code.",
      ],
      [
        "Describe the difference between a process and a thread.",
        "A process has its own address space. Threads within a process share its memory and resources while maintaining separate execution stacks.",
      ],
    ],
  ],
  HCL: [
    "systems and networking",
    [
      [
        "What is a deadlock, and name one way to prevent it?",
        "Deadlock occurs when tasks wait indefinitely for resources held by each other. A consistent lock acquisition order can remove circular waiting.",
      ],
      [
        "How do TCP and UDP differ?",
        "TCP provides an ordered, reliable byte stream with connection management. UDP sends independent datagrams without guaranteeing delivery or order.",
      ],
      [
        "What should an incident handover include?",
        "Impact, timeline, evidence, actions taken, current status, known risks and the owner of the next action.",
      ],
    ],
  ],
  Reliance: [
    "digital platforms and scale",
    [
      [
        "Why might a product catalogue use a cache?",
        "To reduce latency and database load for frequently read products. Invalidation or expiry is needed to keep cached values sufficiently fresh.",
      ],
      [
        "Explain horizontal scaling.",
        "Add more application instances and distribute traffic across them. Shared state and database capacity must also be considered.",
      ],
      [
        "How would you keep a stock update consistent with a purchase?",
        "Use a transaction or atomic conditional update so stock cannot fall below zero, and make retries idempotent.",
      ],
    ],
  ],
  Airtel: [
    "telecom and service reliability",
    [
      [
        "What does DNS do when a user opens a website?",
        "DNS resolves the hostname into an address that the client can use to connect to the service.",
      ],
      [
        "How do latency and bandwidth differ?",
        "Latency is the time needed for data to travel or a request to complete. Bandwidth is the rate at which data can be transferred.",
      ],
      [
        "How would you investigate intermittent connection failures?",
        "Correlate timestamps, affected locations, network paths, packet loss and service logs; compare failing and healthy sessions.",
      ],
    ],
  ],
  Swiggy: [
    "delivery and real-time systems",
    [
      [
        "Which algorithm finds the shortest path when all road weights are non-negative?",
        "Dijkstra's algorithm finds shortest paths for non-negative edge weights. A priority queue improves efficiency.",
      ],
      [
        "A user taps Place order twice. How can you prevent duplicate orders?",
        "Use an idempotency key and a server-side uniqueness constraint so repeated requests return the same operation result.",
      ],
      [
        "Why should a delivery estimate show a range rather than a guaranteed minute?",
        "Traffic, preparation time and travel conditions vary. A range communicates uncertainty more accurately.",
      ],
    ],
  ],
  Zomato: [
    "search and order platforms",
    [
      [
        "How can you efficiently search restaurants by city and cuisine?",
        "Use indexes aligned to the filter patterns, such as a composite index on city and cuisine, and check the query plan with representative data.",
      ],
      [
        "What is pagination, and why does it help an order list?",
        "Pagination retrieves a bounded portion of a result set, reducing response size, memory use and rendering work.",
      ],
      [
        "How would you design fair handling for a failed payment on an order?",
        "Track payment and order states, use idempotent callbacks, reconcile uncertain results and communicate the status clearly to the customer.",
      ],
    ],
  ],
  Razorpay: [
    "payments and API correctness",
    [
      [
        "Why is idempotency especially useful for payment requests?",
        "A client may retry after a timeout without knowing whether a charge succeeded. Idempotency ensures the same operation does not create multiple charges.",
      ],
      [
        "What should a service do with an invalid webhook signature?",
        "Reject the request without applying the event. Verify signatures using the provider's documented method and keep replay protection in place.",
      ],
      [
        "Why should monetary values avoid binary floating-point arithmetic?",
        "Many decimal fractions are not represented exactly in binary. Integer minor units or an appropriate decimal type help preserve exact amounts.",
      ],
    ],
  ],
  Zerodha: [
    "financial data and reliability",
    [
      [
        "How can a database transaction protect a ledger entry?",
        "It can ensure related records are committed together or all rolled back, avoiding a partially recorded operation.",
      ],
      [
        "What is the difference between authentication and authorization?",
        "Authentication establishes who the user is. Authorization determines which actions or resources that identity may access.",
      ],
      [
        "How would you display delayed market data responsibly?",
        "Show the timestamp and delayed status prominently, avoid implying that the data is live, and handle stale data explicitly.",
      ],
    ],
  ],
  Meta: [
    "graphs and product systems",
    [
      [
        "How would you find the shortest number of connections between two users in an unweighted graph?",
        "Use breadth-first search and track visited nodes. BFS explores nodes in increasing edge-distance order.",
      ],
      [
        "What trade-off does denormalizing a frequently read feed introduce?",
        "It can make reads faster but increases duplicate data and the work required to keep updates consistent.",
      ],
      [
        "How would you measure whether a new feature improved the user experience?",
        "Define a user-centered metric and guardrails, compare against a baseline or controlled experiment and check for unintended effects.",
      ],
    ],
  ],
  Amazon: [
    "queues and distributed systems",
    [
      [
        "Why might an order service place fulfillment work on a queue?",
        "A queue decouples request handling from slower processing and absorbs traffic bursts. Consumers must still handle retries and duplicates safely.",
      ],
      [
        "What is eventual consistency?",
        "Replicas may briefly disagree after a write, but converge if no new updates occur. The application must account for temporarily stale reads.",
      ],
      [
        "How would you explain a decision you made with incomplete information?",
        "State the goal, known evidence, uncertainty, reversible options, decision and how you checked the outcome.",
      ],
    ],
  ],
  Netflix: [
    "streaming and resilient services",
    [
      [
        "How does a content delivery network help video playback?",
        "It places content closer to viewers, which can reduce origin load and delivery latency.",
      ],
      [
        "What is a circuit breaker in a service architecture?",
        "It temporarily stops calls to a repeatedly failing dependency, allowing controlled recovery and preventing cascading failures.",
      ],
      [
        "Why does adaptive video streaming change quality during playback?",
        "It adjusts bitrate to estimated network capacity and buffer conditions to reduce interruptions while using available bandwidth.",
      ],
    ],
  ],
  Google: [
    "algorithms and information retrieval",
    [
      [
        "How would you return the top k frequent words from a large list?",
        "Count frequencies with a hash map, then maintain a size-k heap or sort the distinct words. Define a tie-break rule for equal frequencies.",
      ],
      [
        "Why does binary search require an ordered search space?",
        "Each comparison must safely eliminate one side of the remaining range. Ordering provides that guarantee.",
      ],
      [
        "How would you clarify an ambiguous problem before coding?",
        "Ask about inputs, constraints, edge cases, expected output and success criteria; then confirm the approach with a small example.",
      ],
    ],
  ],
};
const rows = logos.map((logo, i) => {
  const [focus, technical] = profiles[logo.companyName];
  const price = 800 + 40 * i,
    discount = 10 + (i % 4) * 5,
    final = (price * (100 - discount)) / 100;
  const speed = 45 + 3 * i,
    time = 2 + (i % 3),
    distance = speed * time;
  return {
    companyName: logo.companyName,
    slug: logo.slug,
    description: `Mock preparation guide for ${logo.companyName}: original model questions focused on ${focus}. Not an official hiring guide or authentic previous-year paper.`,
    hiringProcedure: `MOCK HIRING PROCEDURE - Illustrative practice pathway only. This does not represent ${logo.companyName}'s actual recruitment process.\n\n01. Aptitude warm-up\nPractise percentages, speed, numerical reasoning and clear reading.\n\n02. Technical fundamentals\nWork through the original practice questions on ${focus}. Explain assumptions and edge cases.\n\n03. Problem-solving discussion\nPresent a solution, consider alternatives and discuss correctness and trade-offs.\n\n04. Project and communication practice\nExplain your contribution to a project, a challenge you faced and what you learned.`,
    papers: [
      {
        title: `${logo.companyName} - Mock model paper`,
        url: `/api/v1/placement-samples/${logo.slug}-model-paper.pdf`,
      },
    ],
    practiceQuestions: [
      {
        question: `An item priced at INR ${price} is discounted by ${discount}%. What is its sale price?`,
        answer: `INR ${final}. The discount is ${price} x ${discount}/100 = ${price - final}; subtract it from the original price.`,
      },
      {
        question: `A vehicle travels ${distance} km in ${time} hours. What is its average speed?`,
        answer: `${speed} km/h. Average speed = distance / time = ${distance} / ${time}.`,
      },
      ...technical.map(([question, answer]) => ({ question, answer })),
    ],
  };
});
await writeFile(
  new URL("./company-pyq-mock-content.json", import.meta.url),
  JSON.stringify(rows, null, 2) + "\n",
);
console.log(
  `Prepared ${rows.length} mock guides and ${rows.reduce((n, r) => n + r.practiceQuestions.length, 0)} original practice questions.`,
);
