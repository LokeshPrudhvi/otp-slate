export const colors = {
  primary: "#0F2747",
  primaryLight: "#E9EFF7",
  background: "#F2F5FA",
  card: "#FFFFFF",
  text: "#152A43",
  muted: "#64748B",
  line: "#DFE6EF",
  teal: "#008776",
  tealLight: "#E7F6F1",
  purple: "#7956B8",
  purpleLight: "#F1ECFA",
  amber: "#A56A00",
  amberLight: "#FFF4DC",
  red: "#B63838",
  redLight: "#FCEDED",
  dark: "#212121",
  darkCard: "#2D2D2D",
  darkText: "#F0F0F0",
};
export const radius = { button: 8, input: 8, card: 14 };
export const subjectStyle = {
  quantitative: {
    color: colors.teal,
    background: colors.tealLight,
    icon: "bar-chart-2" as const,
  },
  reasoning: {
    color: colors.purple,
    background: colors.purpleLight,
    icon: "git-merge" as const,
  },
  verbal: {
    color: "#396DA5",
    background: "#EAF1FC",
    icon: "book-open" as const,
  },
  "soft-skills": {
    color: colors.amber,
    background: colors.amberLight,
    icon: "users" as const,
  },
};
