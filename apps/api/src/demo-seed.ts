import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, or } from "drizzle-orm";
import type { Course, Lesson, Resume } from "@slate/contracts";
import type { Auth } from "./auth.js";
import { scoped, type Database } from "./database.js";
import { seedDevelopment } from "./dev-seed.js";
import { developmentPassword } from "./development-login.js";
import { demoOrganizations } from "./demo-data.js";
import * as s from "./schema.js";

const names = [
  "Aarav Sharma",
  "Ananya Reddy",
  "Rohan Mehta",
  "Diya Patel",
  "Arjun Nair",
  "Ishita Rao",
  "Aditya Verma",
  "Sneha Iyer",
  "Karthik Menon",
  "Priya Desai",
  "Vikram Singh",
  "Meera Joshi",
  "Rahul Kapoor",
  "Nisha Gupta",
  "Siddharth Jain",
  "Kavya Shah",
  "Varun Reddy",
  "Aditi Kulkarni",
  "Harsha Kumar",
  "Sanjana Das",
  "Pranav Rao",
  "Tanvi Agarwal",
  "Dev Patel",
  "Shruti Nair",
  "Abhinav Sinha",
  "Pooja Menon",
  "Nikhil Bansal",
  "Ritika Roy",
  "Akash Mishra",
  "Swathi Rao",
  "Yash Thakur",
  "Neha Chawla",
];
const courseSpecs: {
  title: string;
  track: string;
  description: string;
  topics: string[];
}[] = [
  {
    title: "C Programming Fundamentals",
    track: "foundation",
    description:
      "Build a strong foundation in procedural programming, memory and problem solving with C.",
    topics: [
      "Variables and data types|Choose integer, floating-point and character types to represent your inputs. Use printf and scanf to inspect values and validate assumptions.",
      "Conditions and loops|Use if, switch, for and while to express decisions and repetition. Trace the first and last loop iteration to catch boundary errors.",
      "Functions and scope|Separate a program into small functions. Pass inputs explicitly and describe the return value before writing the implementation.",
      "Arrays and strings|Store related values in contiguous arrays. Remember that C strings end with a null character and always reserve room for it.",
      "Pointers and memory|A pointer stores an address. Use & to take an address and * to access a pointed-to value; distinguish pointer lifetime from object lifetime.",
      "Structures and files|Group related fields with a struct. Check file-opening errors, close resources and handle malformed records.",
    ],
  },
  {
    title: "C++ Programming Essentials",
    track: "foundation",
    description:
      "Learn modern C++, STL containers, object-oriented design and resource management.",
    topics: [
      "Modern C++ basics|Use clear types, const and auto where the inferred type is obvious. Prefer value semantics for simple data.",
      "Vectors and strings|Use std::vector and std::string instead of manually managed buffers. Check indexing and understand iterator invalidation.",
      "Classes and encapsulation|Group behavior and data behind a small public interface. Preserve class invariants through constructors.",
      "STL algorithms|Use sort, find and accumulate to express common operations. Choose an algorithm that matches the container and required complexity.",
      "RAII and ownership|Tie resource lifetime to object lifetime. Prefer unique_ptr for exclusive ownership and avoid raw owning pointers.",
      "Templates and exceptions|Write generic functions when the same algorithm works for several types. Catch exceptions where you can recover or add useful context.",
    ],
  },
  {
    title: "Java Programming Fundamentals",
    track: "foundation",
    description:
      "Move from Java syntax to collections, reusable classes and practical application design.",
    topics: [
      "Java types and control flow|Represent data with primitives and objects. Use clear conditionals and loops and check numeric overflow.",
      "Classes and interfaces|Define small interfaces that describe behavior. Prefer composition when inheritance does not model a true is-a relationship.",
      "Collections framework|Choose List, Set or Map according to ordering, uniqueness and lookup requirements.",
      "Exceptions and validation|Validate inputs at boundaries. Use try-with-resources for closeable resources and give callers actionable failure messages.",
      "Streams and lambdas|Use stream pipelines for clear transformations. Avoid hidden side effects in map and filter operations.",
      "Testing Java programs|Separate pure business logic from I/O so unit checks can exercise edge cases directly.",
    ],
  },
  {
    title: "Aptitude Assessment Preparation",
    track: "hiring",
    description:
      "Prepare for quantitative and reasoning rounds with timed, topic-focused practice.",
    topics: [
      "Percentages and ratios|Convert percentage changes into multiplication factors. Compare ratios only after normalizing the quantities.",
      "Profit, loss and interest|Distinguish cost price, selling price and marked price. Write down the base of each percentage before calculating.",
      "Time, speed and distance|Keep units consistent and use average speed as total distance divided by total time.",
      "Data interpretation|Read chart labels and units first. Estimate the expected range before doing a detailed calculation.",
      "Probability and counting|Define the sample space and count favorable outcomes. Avoid counting the same arrangement twice.",
      "Timed assessment strategy|Prioritize questions you can solve accurately, mark uncertain ones and reserve time to review calculations.",
    ],
  },
  {
    title: "Typing & Workplace Skills",
    track: "hiring",
    description:
      "Develop typing accuracy, professional communication and confidence in workplace assessments.",
    topics: [
      "Typing accuracy|Keep a steady rhythm and correct recurring mistakes. Measure accuracy before aiming for higher speed.",
      "Building typing speed|Use short focused sessions, relaxed posture and a consistent home-row technique.",
      "Professional email|Write a clear subject, state the request early and include the context needed for a response.",
      "Reading comprehension|Identify the main argument and separate evidence from assumptions.",
      "Workplace communication|Explain progress, blockers and next steps in language your audience understands.",
      "Assessment rehearsal|Practise a short typing passage, comprehension question and written response in one sitting.",
    ],
  },
  {
    title: "Coding & Web Assessment Preparation",
    track: "hiring",
    description:
      "Understand coding-round expectations and prepare small, accessible web solutions.",
    topics: [
      "Reading a problem contract|Identify inputs, outputs, constraints and ambiguous cases before choosing an algorithm.",
      "Test-case design|Include empty, smallest, largest, duplicate and negative-value cases when the input contract permits them.",
      "Algorithm complexity|Estimate how time and memory grow with input size. Compare that estimate with the constraints.",
      "Web layout assessments|Build semantic HTML and a responsive layout before adding decorative details.",
      "Form validation|Keep client feedback helpful while validating authoritative rules on the server.",
      "Submission checklist|Run checks, document assumptions and verify the project can be set up from a clean checkout.",
    ],
  },
  {
    title: "Competitive Aptitude",
    track: "crt",
    description:
      "Sharpen quantitative reasoning with structured campus recruitment preparation.",
    topics: [
      "Number systems|Use divisibility, remainders and prime factorization to simplify calculations.",
      "Algebra and equations|Translate the wording into equations and check that the solution fits every condition.",
      "Time and work|Represent each person's work rate as a fraction of the task per unit time.",
      "Permutations and combinations|Decide whether order matters before choosing a counting method.",
      "Quantitative comparison|Use bounds and estimation when an exact calculation is unnecessary.",
      "Mock-round review|Group mistakes by concept, calculation and time management and choose one improvement for the next round.",
    ],
  },
  {
    title: "Logical Reasoning",
    track: "crt",
    description:
      "Learn systematic approaches to sequences, arrangements and deductive reasoning.",
    topics: [
      "Patterns and sequences|Test simple relationships between neighboring terms before proposing a more complex pattern.",
      "Syllogisms|Track what is guaranteed by the statements and avoid assuming an unstated overlap.",
      "Seating arrangements|Draw a consistent diagram and place the most restrictive clues first.",
      "Directions and distances|Record each movement on coordinate axes, then calculate the final displacement.",
      "Statements and assumptions|Separate facts, assumptions and conclusions. A plausible statement is not always logically required.",
      "Reasoning rehearsal|Use a timed set and explain why each incorrect option fails after finishing.",
    ],
  },
  {
    title: "Competitive Programming",
    track: "crt",
    description:
      "Build a practical contest workflow using common patterns and careful complexity analysis.",
    topics: [
      "Contest workflow|Read all tasks, choose an order and test the simplest valid solution before optimizing.",
      "Sorting and searching|Sort when it simplifies the invariant. Use binary search only when the search condition is monotonic.",
      "Greedy strategies|State the local choice and justify why it cannot make the final solution worse.",
      "Prefix sums|Precompute cumulative values to answer repeated range questions efficiently.",
      "Graph traversal|Use BFS for unweighted shortest paths and DFS to explore structure and connected components.",
      "Contest review|Re-solve one missed problem and record the pattern and the reason your first approach failed.",
    ],
  },
  {
    title: "Interview Skills",
    track: "crt",
    description:
      "Prepare introductions, technical explanations and strong behavioral interview stories.",
    topics: [
      "Your introduction|Connect your current studies, relevant projects and the role you want in a concise introduction.",
      "STAR stories|Describe the situation, task, your action and the measurable result. Be clear about your own contribution.",
      "Explaining technical work|Start with the problem, then discuss design choices, tradeoffs and evidence that the solution worked.",
      "Coding interview collaboration|Clarify assumptions, talk through your approach and test edge cases with the interviewer.",
      "Resume walkthrough|Be ready to explain every skill, project and claimed outcome on your resume.",
      "Mock interview reflection|Record one strong answer, one unclear answer and a specific improvement for your next rehearsal.",
    ],
  },
  {
    title: "Data Structures & Algorithms",
    track: "dsa",
    description:
      "Master arrays, linked lists, stacks, trees and graphs with practical reasoning.",
    topics: [
      "Arrays and hashing|Choose a hash map when key-based lookup reduces repeated scanning. Consider collision handling and memory use.",
      "Linked lists|Maintain the links carefully when inserting or removing nodes. Trace head, tail and single-node cases.",
      "Stacks and queues|Match LIFO or FIFO behavior to the problem, such as expression parsing or breadth-first exploration.",
      "Trees and search|Use traversal order to match the output you need. Check empty and unbalanced trees.",
      "Graphs and shortest paths|Choose BFS for equal-cost edges and Dijkstra for nonnegative weighted edges.",
      "Complexity and practice|Justify complexity and validate the algorithm with a small example before writing code.",
    ],
  },
  {
    title: "Advanced DSA",
    track: "dsa",
    description:
      "Develop confidence in dynamic programming, advanced trees and optimization problems.",
    topics: [
      "Dynamic programming states|Define exactly what each state means and list the transitions that preserve that meaning.",
      "Memoization and tabulation|Choose between recursive caching and iterative table filling based on dependencies and stack depth.",
      "Backtracking|Explore candidates, reject invalid choices early and restore state when returning from recursion.",
      "Heaps and priority queues|Keep the most relevant candidate at the top. Use heaps for scheduling and top-k problems.",
      "Disjoint-set union|Track component representatives with path compression and union by size for repeated connectivity queries.",
      "Range-query structures|Use Fenwick or segment trees when updates and queries must both be efficient.",
    ],
  },
  {
    title: "MERN Full Stack Development",
    track: "fullstack",
    description:
      "Build a complete application using MongoDB, Express, React and Node.js.",
    topics: [
      "React components and state|Split the screen into components with clear responsibilities and keep a single owner for shared state.",
      "Accessible forms|Label inputs, show errors near the field and make the complete form usable with a keyboard.",
      "Express REST APIs|Validate requests at the boundary and return predictable status codes and response shapes.",
      "MongoDB data modeling|Model data around access patterns and enforce required fields and appropriate indexes.",
      "Authentication and access|Distinguish identity from permission. Check access on the server for every protected resource.",
      "Capstone and deployment|Build a task manager, add checks and document setup, configuration and operational limitations.",
    ],
  },
  {
    title: "Java Full Stack Development",
    track: "fullstack",
    description:
      "Connect a Spring Boot backend, relational database and responsive frontend.",
    topics: [
      "Spring Boot foundations|Separate controllers, service logic and persistence so changes have clear boundaries.",
      "REST API contracts|Validate inputs, use stable resource identifiers and make failure responses useful to callers.",
      "JPA and SQL|Understand generated queries, transactions and the difference between lazy and eager loading.",
      "Frontend integration|Handle loading, empty and failure states while calling the API from the client.",
      "Security and configuration|Keep secrets outside source control and enforce role and resource permissions on the backend.",
      "Capstone application|Build an application tracker with searchable records, a README and a reproducible local setup.",
    ],
  },
  {
    title: "Python Full Stack Development",
    track: "fullstack",
    description:
      "Build useful web applications with Python, Django and a responsive client.",
    topics: [
      "Django project structure|Organize settings, URLs, views and models so each application has a coherent responsibility.",
      "Models and migrations|Describe database changes explicitly and test the migration path using representative data.",
      "Views and API endpoints|Validate incoming data and keep domain behavior separate from transport concerns.",
      "Templates and frontend|Use semantic HTML, accessible forms and clear navigation for the main user tasks.",
      "Authentication and permissions|Use the framework's password handling and check ownership and role access for every write.",
      "Capstone project|Build a student opportunity tracker and document installation, configuration and core checks.",
    ],
  },
  ...["C++", "Java", "Python"].map((language) => ({
    title: `${language} Programming Practice`,
    track: "competitive",
    description: `Strengthen ${language} fluency with topic-based programming exercises and interview patterns.`,
    topics: [
      "Input, output and edge cases|Translate the contract into a small set of examples, including boundary and invalid inputs where applicable.",
      "Array patterns|Practise scanning, two pointers, sliding windows and prefix sums and state the invariant for each pattern.",
      "Strings and hashing|Use frequency maps and sets to compare, count and detect repetitions efficiently.",
      "Recursion and search|Define a base case and show that each recursive step makes progress toward it.",
      "Trees and graphs|Choose a traversal strategy and keep visited state consistent to avoid processing cycles repeatedly.",
      "Mixed problem rehearsal|Explain your approach, estimate complexity and review errors before attempting another timed problem.",
    ],
  })),
];
function id(key: string) {
  const hex = createHash("sha256")
    .update(`slate-local-demo-v1:${key}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export async function seedDemo(db: Database, auth: Auth) {
  await seedDevelopment(db, auth);
  const [primaryMember] = await scoped(db, { platform: true }, (tx) =>
    tx
      .select({ member: s.members })
      .from(s.members)
      .innerJoin(s.user, eq(s.members.authUserId, s.user.id))
      .where(eq(s.user.email, "student@slate.test")),
  );
  const primaryId = primaryMember.member.organizationId!;
  const organizations = await scoped(db, { platform: true }, async (tx) => {
    await tx
      .update(s.organizations)
      .set({ name: demoOrganizations[0], updatedAt: new Date() })
      .where(eq(s.organizations.id, primaryId));
    for (const name of demoOrganizations.slice(1))
      await tx
        .insert(s.organizations)
        .values({ id: id(name), name })
        .onConflictDoNothing();
    return (await tx.select().from(s.organizations)).filter((org) =>
      demoOrganizations.includes(org.name),
    );
  });
  await db
    .update(s.user)
    .set({ name: names[0] })
    .where(eq(s.user.email, "student@slate.test"));
  await db
    .update(s.user)
    .set({ name: "Priya Rao" })
    .where(eq(s.user.email, "admin@slate.test"));
  await db
    .update(s.user)
    .set({ name: "Meera Iyer" })
    .where(eq(s.user.email, "viewer@slate.test"));
  for (
    let organizationIndex = 0;
    organizationIndex < organizations.length;
    organizationIndex++
  ) {
    const organization = organizations[organizationIndex],
      primary = organization.id === primaryId;
    const count = primary
      ? 32
      : organization.name === demoOrganizations[1]
        ? 18
        : 12;
    for (let index = primary ? 1 : 0; index < count; index++) {
      const email = `demo.${id(organization.name).slice(0, 8)}.${index + 1}@slate.test`;
      const [existing] = await db
        .select()
        .from(s.user)
        .where(eq(s.user.email, email));
      const identity =
        existing ||
        (
          await auth.api.createUser({
            body: {
              email,
              name: names[index % names.length],
              password: developmentPassword,
              role: "user",
            },
          })
        ).user;
      await scoped(db, { platform: true }, (tx) =>
        tx
          .insert(s.members)
          .values({
            id: id(email),
            authUserId: identity.id,
            organizationId: organization.id,
            role: "student",
            status: index === count - 1 ? "suspended" : "active",
            passwordSetupComplete: index !== count - 2,
            phoneVerifiedAt: index !== count - 2 ? new Date() : null,
            phone: "+910000000000",
            features:
              index % 7 === 0 ? ["rankings"] : ["jobs", "resume", "rankings"],
          })
          .onConflictDoNothing(),
      );
    }
    for (let index = 0; index < (primary ? 1 : 2); index++) {
      const email = `viewer.${id(organization.name).slice(0, 8)}.${index}@slate.test`;
      const [existing] = await db
        .select()
        .from(s.user)
        .where(eq(s.user.email, email));
      const identity =
        existing ||
        (
          await auth.api.createUser({
            body: {
              email,
              name: ["Sanjay Menon", "Anita Rao"][index],
              password: developmentPassword,
              role: "user",
            },
          })
        ).user;
      await scoped(db, { platform: true }, (tx) =>
        tx
          .insert(s.members)
          .values({
            id: id(email),
            authUserId: identity.id,
            organizationId: organization.id,
            role: "organization_viewer",
            passwordSetupComplete: true,
          })
          .onConflictDoNothing(),
      );
    }
  }
  await scoped(db, { platform: true }, async (tx) => {
    for (const spec of courseSpecs) {
      let [course] = await tx
        .select()
        .from(s.courses)
        .where(
          or(eq(s.courses.id, id(spec.title)), eq(s.courses.title, spec.title)),
        );
      if (!course)
        [course] = await tx
          .insert(s.courses)
          .values({
            id: id(spec.title),
            title: spec.title,
            track: spec.track,
            description: spec.description,
            status: "published",
          })
          .returning();
      const [version] = await tx
        .select()
        .from(s.versions)
        .where(eq(s.versions.courseId, course.id));
      if (!version) {
        const lessons: Lesson[] = spec.topics.map((topic, index) => {
          const [title, explanation] = topic.split("|");
          return {
            id: id(`${spec.title}:${index}`),
            title,
            body: `${explanation}\n\nLearning goal\nExplain the idea in your own words and identify when it is useful.\n\nGuided activity\nCreate a small example, work through it by hand, then implement or write out your solution. Include a typical case and a boundary case.\n\nReflection\nWhat assumption did you make? How would you verify it? Write one question to discuss during your next live class.\n\nThis is a sample lesson for the local product preview.`,
          };
        });
        await tx.insert(s.versions).values({
          id: id(`${spec.title}:version:1`),
          courseId: course.id,
          number: 1,
          title: spec.title,
          description: spec.description,
          lessons,
        });
      }
    }
    const allVersions = await tx
      .select({ course: s.courses, version: s.versions })
      .from(s.courses)
      .innerJoin(s.versions, eq(s.versions.courseId, s.courses.id))
      .where(eq(s.courses.status, "published"))
      .orderBy(desc(s.versions.number));
    const courses = allVersions.filter(
      (item, index) =>
        allVersions.findIndex((other) => other.course.id === item.course.id) ===
        index,
    );
    const demoIds = organizations.map((org) => org.id);
    const students = (
      await tx.select().from(s.members).where(eq(s.members.role, "student"))
    ).filter((member) => demoIds.includes(member.organizationId!));
    for (let index = 0; index < students.length; index++) {
      const student = students[index],
        test = student.id === primaryMember.member.id;
      for (let courseIndex = 0; courseIndex < courses.length; courseIndex++) {
        const { course, version } = courses[courseIndex];
        const sampleKey = parseInt(
          id(`${student.id}:${course.id}`).slice(0, 8),
          16,
        );
        if (!test && course.track !== "foundation" && sampleKey % 3 !== 0)
          continue;
        await tx
          .insert(s.grants)
          .values({
            organizationId: student.organizationId!,
            memberId: student.id,
            courseId: course.id,
            versionId: version.id,
          })
          .onConflictDoNothing();
        const [grant] = await tx
          .select()
          .from(s.grants)
          .where(
            and(
              eq(s.grants.memberId, student.id),
              eq(s.grants.courseId, course.id),
            ),
          );
        if (grant.versionId !== version.id) continue;
        const ratio = test ? 0.42 : (sampleKey % 101) / 100;
        for (const [lessonIndex, lesson] of version.lessons
          .slice(0, Math.floor(version.lessons.length * ratio))
          .entries()) {
          await tx
            .insert(s.progress)
            .values({
              organizationId: student.organizationId!,
              memberId: student.id,
              versionId: version.id,
              lessonId: lesson.id,
              completedAt: new Date(
                Date.now() - (28 - ((index + lessonIndex) % 26)) * 86400_000,
              ),
            })
            .onConflictDoNothing();
        }
      }
    }
    for (const organization of organizations) {
      for (const [index, [title, company, description]] of [
        [
          "Graduate Software Engineer",
          "Blueleaf Technologies",
          "Build and test APIs with a small product team. Skills: Java or Python, SQL and Git. Location: Hyderabad · Hybrid.",
        ],
        [
          "Frontend Developer Intern",
          "Orbit Digital",
          "Create responsive React interfaces and accessible forms. Skills: JavaScript, HTML, CSS and React. Location: Bengaluru.",
        ],
        [
          "Java Backend Trainee",
          "Cedar Systems",
          "Work on Spring Boot services, database queries and integration checks. Location: Pune · Full time.",
        ],
        [
          "Python Developer Intern",
          "Aurora Analytics",
          "Write data workflows and simple Django APIs. Skills: Python, debugging and PostgreSQL. Location: Remote.",
        ],
        [
          "Full Stack Engineer Intern",
          "PixelWorks Studio",
          "Connect a React client to a Node.js API and deliver a small project. Location: Chennai · Hybrid.",
        ],
        [
          "Quality Engineering Trainee",
          "Summit Software",
          "Design test cases, investigate failures and document findings. Skills: attention to detail, programming and communication. Location: Hyderabad.",
        ],
      ].entries())
        await tx
          .insert(s.jobs)
          .values({
            id: id(`${organization.id}:job:${index}`),
            organizationId: organization.id,
            title,
            company,
            description: `${description}\n\nSample opportunity for the local preview. The application button opens an example website; this is not an actual vacancy.`,
            url: "https://example.com",
            postedAt: new Date(Date.now() - index * 86400_000),
          })
          .onConflictDoNothing();
    }
    const resume: Resume = {
      name: names[0],
      title: "Graduate Software Engineer",
      email: "aarav.sharma@example.test",
      phone: "+91 00000 00000",
      location: "Hyderabad, India",
      links: "github.com/example · portfolio.example.test",
      summary:
        "Computer science student with practical experience building Python APIs and React interfaces. Strong foundation in data structures, SQL and collaborative problem solving. Looking for a graduate role where I can deliver reliable, accessible software.",
      skills:
        "Python, Java, JavaScript, React, Node.js, PostgreSQL, Git, REST APIs, Data structures",
      experience:
        "Software Engineering Intern — Blueleaf Labs (Sample) | May–July 2026\n• Built a searchable internal dashboard using React and a REST API.\n• Added input validation and documented reproducible checks for core workflows.\n• Collaborated with a four-person team using Git and peer review.",
      projects:
        "Campus Opportunity Tracker | React, Node.js, PostgreSQL\n• Created a responsive application tracker with filters and accessible forms.\n• Designed APIs with validation, pagination and ownership checks.\n\nStudy Planner | Python\n• Developed a command-line tool to group study sessions and summarize progress.",
      education:
        "B.Tech, Computer Science — Northstar Institute of Technology (Sample) | 2023–2027\nRelevant coursework: Data Structures, Database Systems, Computer Networks",
      certifications:
        "Python Fundamentals — Sample learning course | 2026\nWeb Accessibility Basics — Sample workshop | 2026",
      template: "modern",
    };
    const [existing] = await tx
      .select()
      .from(s.resumes)
      .where(eq(s.resumes.memberId, primaryMember.member.id));
    if (!existing)
      await tx.insert(s.resumes).values({
        organizationId: primaryId,
        memberId: primaryMember.member.id,
        data: resume,
      });
    else if (
      !existing.data.summary &&
      !existing.data.experience &&
      !existing.data.projects
    )
      await tx
        .update(s.resumes)
        .set({
          data: resume,
          revision: existing.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(s.resumes.id, existing.id));
    await tx
      .insert(s.audit)
      .values({
        id: id("audit:seed-v1"),
        organizationId: primaryId,
        action: "demo.seeded",
        resourceId: primaryId,
      })
      .onConflictDoNothing();
    console.log(
      `Sample data ready: ${organizations.length} organizations, ${students.length} students, ${courses.length} published course versions, ${organizations.length * 6} job cards and a complete resume.`,
    );
  });
}
