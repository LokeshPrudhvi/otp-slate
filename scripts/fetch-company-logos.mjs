import { writeFile } from "node:fs/promises";
import sharp from "sharp";
const metadataResponse = await fetch(
  "https://raw.githubusercontent.com/simple-icons/simple-icons/develop/data/simple-icons.json",
);
if (!metadataResponse.ok) throw new Error("Brand metadata unavailable");
const catalogue = await metadataResponse.json();
const companies = [
  ["TCS", "Tata Consultancy Services", "tcs"],
  ["Infosys", "Infosys", "infosys"],
  ["Wipro", "Wipro", "wipro"],
  ["HCL", "HCL", "hcl"],
  ["Reliance", "Reliance Industries Limited", "relianceindustrieslimited"],
  ["Airtel", "Airtel", "airtel"],
  ["Swiggy", "Swiggy", "swiggy"],
  ["Zomato", "Zomato", "zomato"],
  ["Razorpay", "Razorpay", "razorpay"],
  ["Zerodha", "Zerodha", "zerodha"],
  ["Meta", "Meta", "meta"],
  ["Amazon", "Amazon", "amazon"],
  ["Netflix", "Netflix", "netflix"],
  ["Google", "Google", "google"],
];
const rows = await Promise.all(
  companies.map(async ([name, title, slug]) => {
    const meta = (Array.isArray(catalogue) ? catalogue : catalogue.icons).find(
      (i) => i.title === title,
    );
    const source =
      slug === "amazon"
        ? "https://raw.githubusercontent.com/FortAwesome/Font-Awesome/7.x/svgs/brands/amazon.svg"
        : `https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/${slug}.svg`;
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Logo source failed: ${name} ${res.status}`);
    let svg = await res.text();
    if (!svg.includes("<svg")) throw new Error("Invalid SVG");
    svg = svg.replace("<svg ", `<svg fill="#${meta?.hex ?? "232F3E"}" `);
    const png = await sharp(Buffer.from(svg))
      .resize(256, 256, { fit: "inside" })
      .extend({
        top: 32,
        bottom: 32,
        left: 32,
        right: 32,
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      })
      .png()
      .toBuffer();
    await writeFile(
      new URL(`../apps/api/assets/company-logos/${slug}.png`, import.meta.url),
      png,
    );
    return {
      companyName: name,
      slug,
      fileName: `${slug}.png`,
      source,
      brandSource: meta?.source ?? "https://fontawesome.com/icons/amazon",
      license:
        slug === "amazon"
          ? "CC BY 4.0 (Font Awesome Free icons)"
          : "CC0-1.0 (Simple Icons)",
      size: png.length,
    };
  }),
);
await writeFile(
  new URL("../apps/api/assets/company-logos/sources.json", import.meta.url),
  JSON.stringify(rows, null, 2) + "\n",
);
console.log(`Prepared ${rows.length} company logos with recorded sources.`);
