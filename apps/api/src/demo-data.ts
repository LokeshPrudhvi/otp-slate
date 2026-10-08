import type {
  Announcement,
  DemoPerformance,
  DemoQuestion,
  LiveExam,
  PracticeAssessment,
} from "@slate/contracts";
import { codingCatalog } from "./coding-catalog.js";

export const demoOrganizations = [
  "Northstar Institute of Technology · Demo",
  "Vertex Engineering College · Demo",
  "Horizon Skills Academy · Demo",
];
export const demoOrganization = (name: string | null | undefined) =>
  Boolean(name && demoOrganizations.includes(name));
const question = (
  id: string,
  prompt: string,
  options: string[],
  answer: number,
  explanation: string,
): DemoQuestion => ({ id, prompt, options, answer, explanation });
const quantitative = [
  question(
    "percent",
    "A laptop costs ₹40,000. Its price increases by 10%, then decreases by 10%. What is the final price?",
    ["₹40,000", "₹39,600", "₹40,400", "₹36,000"],
    1,
    "40,000 × 1.10 × 0.90 = 39,600. The two percentage changes use different bases.",
  ),
  question(
    "ratio",
    "Two teams share 72 tasks in the ratio 5:3. How many tasks does the larger team receive?",
    ["27", "36", "45", "48"],
    2,
    "There are 8 parts; each part is 9 tasks. The larger team gets 5 × 9 = 45.",
  ),
  question(
    "speed",
    "A train covers 180 km in 3 hours. What is its average speed?",
    ["45 km/h", "60 km/h", "90 km/h", "120 km/h"],
    1,
    "Average speed = total distance ÷ total time = 60 km/h.",
  ),
  question(
    "average",
    "The average of 12, 18, 24 and x is 21. Find x.",
    ["24", "26", "28", "30"],
    3,
    "The total must be 21 × 4 = 84. Subtracting 54 gives x = 30.",
  ),
  question(
    "interest",
    "What is the simple interest on ₹5,000 at 8% per annum for 2 years?",
    ["₹400", "₹600", "₹800", "₹1,000"],
    2,
    "Simple interest = principal × rate × time / 100 = ₹800.",
  ),
  question(
    "probability",
    "A fair die is rolled once. What is the probability of getting an even number?",
    ["1/6", "1/3", "1/2", "2/3"],
    2,
    "Three of six outcomes are even: 2, 4 and 6.",
  ),
];
const reasoning = [
  question(
    "sequence",
    "What comes next: 3, 6, 12, 24, …?",
    ["30", "36", "48", "54"],
    2,
    "Each term is twice the previous term.",
  ),
  question(
    "syllogism",
    "All coders are learners. Some learners are designers. Which conclusion must be true?",
    [
      "All coders are designers",
      "Some designers are coders",
      "All coders are learners",
      "No designers are learners",
    ],
    2,
    "Only the first stated relationship is guaranteed. The overlap with designers is unknown.",
  ),
  question(
    "direction",
    "You walk 4 km east, 3 km north, then 4 km west. How far are you from the start?",
    ["3 km", "4 km", "5 km", "11 km"],
    0,
    "The east and west movements cancel. You finish 3 km north of the start.",
  ),
  question(
    "odd",
    "Choose the odd one out: stack, queue, linked list, compiler.",
    ["Stack", "Queue", "Linked list", "Compiler"],
    3,
    "The first three are data structures; a compiler translates programs.",
  ),
];
const interview = [
  question(
    "star",
    "What does the A in the STAR interview method stand for?",
    ["Achievement", "Action", "Analysis", "Answer"],
    1,
    "STAR means Situation, Task, Action and Result.",
  ),
  question(
    "feedback",
    "An interviewer asks about a failed project. Which response is strongest?",
    [
      "Blame the team",
      "Avoid the question",
      "Explain your contribution, learning and next steps",
      "Say you have never failed",
    ],
    2,
    "A specific, accountable example demonstrates reflection and growth.",
  ),
  question(
    "clarify",
    "A coding problem has ambiguous input constraints. What should you do first?",
    [
      "Guess silently",
      "Clarify constraints and examples",
      "Start optimizing immediately",
      "Skip all edge cases",
    ],
    1,
    "Clarify the contract before choosing an algorithm.",
  ),
];
export const demoPractice: PracticeAssessment[] = [
  ...[
    ["aptitude-foundations", "Aptitude fundamentals", quantitative],
    ["percentages", "Percentages & profit and loss", quantitative.slice(0, 4)],
    ["reasoning", "Logical reasoning sprint", reasoning],
    [
      "placement-mock",
      "Placement readiness mock",
      [...quantitative, ...reasoning],
    ],
    [
      "data-interpretation",
      "Data interpretation essentials",
      quantitative.slice(1),
    ],
    ["interview-quiz", "Interview essentials", interview],
  ].map(([id, title, questions], index) => ({
    id: id as string,
    title: title as string,
    description:
      "Work through a focused question set, review explanations and build confidence before placement day.",
    category: index === 5 ? ("skills" as const) : ("aptitude" as const),
    kind: "quiz" as const,
    difficulty: index === 3 ? ("Medium" as const) : ("Easy" as const),
    durationMinutes: index === 3 ? 30 : 15,
    sample: true as const,
    questions: questions as DemoQuestion[],
  })),
  ...codingCatalog,
  {
    id: "typing-accuracy",
    title: "Typing speed & accuracy",
    description: "Practise clear, accurate typing with a one-minute passage.",
    category: "skills",
    kind: "typing",
    difficulty: "Easy",
    durationMinutes: 1,
    sample: true,
    passage:
      "Good software begins with a clear understanding of the problem. Break a large task into smaller steps, test assumptions and communicate your progress. Consistent practice makes complex ideas easier to understand. Focus on accuracy first and speed will follow.",
  },
  ...[
    [
      "mern-project",
      "MERN portfolio project",
      "Build a task manager with React, Express and MongoDB.",
    ],
    [
      "java-project",
      "Java full stack project",
      "Build a REST API with Spring Boot and a responsive client.",
    ],
    [
      "python-project",
      "Python full stack project",
      "Build a Django application with authentication and searchable records.",
    ],
    [
      "responsive-page",
      "Responsive landing page",
      "Build an accessible landing page that works on mobile and desktop.",
    ],
  ].map(([id, title, description]) => ({
    id,
    title,
    description,
    category: "web" as const,
    kind: "project" as const,
    difficulty: "Medium" as const,
    durationMinutes: 90,
    sample: true as const,
    checklist: [
      "Responsive layout and keyboard navigation",
      "Clear README and setup instructions",
      "Input validation and helpful error states",
      "Automated checks for the core behavior",
      "Public repository or project link for review",
    ],
  })),
  {
    id: "interview-stories",
    title: "Tell your story with STAR",
    description: "Prepare strong examples for behavioral interviews.",
    category: "skills",
    kind: "interview",
    difficulty: "Medium",
    durationMinutes: 20,
    sample: true,
    checklist: [
      "Describe a challenge you solved with a team.",
      "Explain a mistake and what you changed afterwards.",
      "Give a measurable example of taking ownership.",
      "Prepare a concise introduction and two questions for the interviewer.",
    ],
  },
];
export function demoExams(): LiveExam[] {
  const now = Date.now();
  return [
    {
      id: "placement-live",
      title: "Campus placement readiness assessment",
      state: "live",
      startsAt: new Date(now - 3600_000).toISOString(),
      endsAt: new Date(now + 3 * 3600_000).toISOString(),
      durationMinutes: 30,
      assessmentId: "placement-mock",
      questionCount: 10,
      sample: true,
    },
    {
      id: "coding-upcoming",
      title: "Weekly coding challenge",
      state: "upcoming",
      startsAt: new Date(now + 86400_000).toISOString(),
      endsAt: new Date(now + 90000_000).toISOString(),
      durationMinutes: 45,
      assessmentId: "two-sum",
      questionCount: 1,
      sample: true,
    },
    {
      id: "aptitude-completed",
      title: "Aptitude checkpoint · Week 3",
      state: "completed",
      startsAt: new Date(now - 3 * 86400_000).toISOString(),
      endsAt: new Date(now - 3 * 86400_000 + 1800_000).toISOString(),
      durationMinutes: 15,
      assessmentId: "aptitude-foundations",
      questionCount: 6,
      score: 83,
      sample: true,
    },
  ];
}
export function demoAnnouncements(): Announcement[] {
  return [
    [
      "placement",
      "Placement readiness assessment is open",
      "Your practice placement assessment is available. Review the instructions, attempt the questions and check your explanations afterwards.",
      "Placement team",
    ],
    [
      "class",
      "Live class: solving problems with two pointers",
      "Join your usual Zoom or Google Meet classroom on Thursday at 6 PM. This preview announcement has no active meeting link.",
      "Learning team",
    ],
    [
      "resume",
      "Resume review week",
      "Complete your profile, add two project outcomes and switch templates to find the layout that suits your experience.",
      "Career services",
    ],
    [
      "courses",
      "New full stack learning paths",
      "MERN, Java and Python full stack modules are now included in your assigned toolkit. Open a module to continue learning.",
      "Course team",
    ],
  ].map(([id, title, body, from], index) => ({
    id,
    title,
    body,
    from,
    date: new Date(Date.now() - index * 86400_000).toISOString(),
    sample: true,
  }));
}
function value(text: string) {
  return [...text].reduce(
    (sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0,
    7,
  );
}
export function demoPerformance(
  students: { id: string; name: string }[],
): DemoPerformance {
  const results = students
    .map((student) => {
      const seed = value(student.id);
      const aptitude = 51 + (seed % 46),
        coding = 43 + ((seed >>> 4) % 54),
        interview = 58 + ((seed >>> 9) % 39);
      return {
        studentId: student.id,
        name: student.name,
        aptitude,
        coding,
        interview,
        average: Math.round((aptitude + coding + interview) / 3),
        attempts: 4 + (seed % 17),
      };
    })
    .sort((a, b) => b.average - a.average || a.name.localeCompare(b.name));
  return {
    results,
    skills: ["Aptitude", "Coding", "Interview"].map((name, index) => ({
      name,
      score: results.length
        ? Math.round(
            results.reduce(
              (sum, result) =>
                sum + [result.aptitude, result.coding, result.interview][index],
              0,
            ) / results.length,
          )
        : 0,
    })),
    trend: Array.from({ length: 6 }, (_, index) => ({
      week: `Week ${index + 1}`,
      activeStudents: Math.round(students.length * (0.4 + index * 0.09)),
      averageScore: 54 + index * 5,
    })),
  };
}
