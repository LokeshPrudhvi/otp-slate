import type { CrtSubjectId } from "@slate/contracts";

export function CrtSubjectArt({ subject }: { subject: CrtSubjectId }) {
  return (
    <svg className="crt-card-art" aria-hidden="true" focusable="false" viewBox="0 0 240 140" fill="none">
      {subject === "quantitative" && (
        <>
          <ellipse cx="124" cy="123" rx="86" ry="10" fill="#B4D1F2" opacity=".45" />
          <circle cx="137" cy="65" r="52" fill="#D3EAFB" />
          <path d="M34 70h16m-8-8v16M193 27h12m-6-6v12" stroke="#6BACE3" strokeWidth="3" strokeLinecap="round" />
          <circle cx="196" cy="104" r="4" fill="#65C9DA" />
          <circle cx="50" cy="34" r="3" fill="#8EC0EC" />
          <g transform="rotate(-9 93 72)">
            <rect x="57" y="19" width="76" height="105" rx="14" fill="#2764A9" />
            <rect x="55" y="15" width="76" height="105" rx="14" fill="#4389D3" />
            <rect x="64" y="25" width="58" height="25" rx="5" fill="#EAF7FF" />
            <path d="M95 33h6v9h-6m11-9h6v9h-6" stroke="#2C689F" strokeWidth="2" strokeLinejoin="round" />
            <rect x="65" y="59" width="14" height="13" rx="4" fill="#C5E4FC" />
            <rect x="86" y="59" width="14" height="13" rx="4" fill="#C5E4FC" />
            <rect x="107" y="59" width="14" height="13" rx="4" fill="#8DD8E8" />
            <rect x="65" y="79" width="14" height="13" rx="4" fill="#C5E4FC" />
            <rect x="86" y="79" width="14" height="13" rx="4" fill="#C5E4FC" />
            <rect x="107" y="79" width="14" height="31" rx="4" fill="#8DD8E8" />
            <rect x="65" y="99" width="35" height="11" rx="4" fill="#C5E4FC" />
            <path d="M111 92h6m-6 5h6" stroke="#2764A9" strokeWidth="2" strokeLinecap="round" />
          </g>
          <g transform="rotate(7 163 80)">
            <rect x="130" y="43" width="71" height="69" rx="10" fill="#90BADF" opacity=".35" />
            <rect x="127" y="39" width="71" height="69" rx="10" fill="white" />
            <path d="M139 94h47" stroke="#DCE9F5" strokeWidth="2" strokeLinecap="round" />
            <rect x="140" y="78" width="9" height="12" rx="2" fill="#9AC9EE" />
            <rect x="156" y="69" width="9" height="21" rx="2" fill="#5AA6E0" />
            <rect x="172" y="57" width="9" height="33" rx="2" fill="#31B4C8" />
            <path d="m139 69 16-9 13 1 16-13m-8 0h8v8" stroke="#327AB6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </>
      )}
      {subject === "reasoning" && (
        <>
          <ellipse cx="125" cy="124" rx="85" ry="9" fill="#CCBCEB" opacity=".45" />
          <circle cx="117" cy="66" r="53" fill="#E5DDF8" />
          <path d="M53 87V53c0-7 5-12 12-12h22m65 1h24c7 0 12 5 12 12v34m-44 28h-26" stroke="#B19AD9" strokeWidth="3" strokeDasharray="4 7" strokeLinecap="round" />
          <circle cx="54" cy="98" r="10" fill="#B09BDD" />
          <circle cx="54" cy="98" r="4" fill="#F6F2FD" />
          <g transform="rotate(-10 106 53)">
            <rect x="73" y="20" width="66" height="66" rx="12" fill="#7959B2" />
            <rect x="70" y="16" width="66" height="66" rx="12" fill="#A087D2" />
            <path d="M83 31h14v9a7 7 0 1 0 14 0v-9h13v35h-13v-8a7 7 0 1 0-14 0v8H83Z" fill="#F4EFFD" />
          </g>
          <g transform="rotate(8 154 85)">
            <rect x="123" y="55" width="67" height="65" rx="13" fill="#7652AB" />
            <rect x="120" y="51" width="67" height="65" rx="13" fill="#B7A1E0" />
            <path d="M133 77h8v-8a7 7 0 0 1 14 0v8h19v25h-41Z" fill="#F9F6FF" />
            <path d="m146 89 6 6 11-12" stroke="#8962BC" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </g>
          <path d="m182 20 7 7-7 7-7-7Z" fill="#BCA5E8" />
          <path d="M42 24v10m-5-5h10M209 65v10m-5-5h10" stroke="#A68ACC" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="93" cy="113" r="4" fill="#9F81CF" />
        </>
      )}
      {subject === "verbal" && (
        <>
          <ellipse cx="120" cy="124" rx="88" ry="9" fill="#A6D6CB" opacity=".45" />
          <circle cx="120" cy="67" r="53" fill="#D5EEE5" />
          <path d="M44 37h12m-6-6v12m152 35h10m-5-5v10" stroke="#77BCAE" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="45" cy="94" r="4" fill="#83CABB" />
          <path d="M59 62c24-4 44 2 61 13 17-11 37-17 61-13v54c-24-3-45 1-61 10-16-9-37-13-61-10Z" fill="#277D74" />
          <path d="M64 55c21-3 40 3 56 14 16-11 35-17 56-14v55c-21-3-41 2-56 12-15-10-35-15-56-12Z" fill="#6DB5A6" />
          <path d="M69 49c22-1 38 6 51 15v52c-14-10-32-15-51-13Z" fill="#FFFDF4" />
          <path d="M171 49c-22-1-38 6-51 15v52c14-10 32-15 51-13Z" fill="white" />
          <path d="M79 64c11 1 21 5 30 10M79 76c11 1 21 5 30 10M79 88c8 1 15 3 21 6M132 74c9-5 19-9 29-10m-29 22c9-5 19-9 29-10m-29 22c6-3 12-6 18-7" stroke="#B6CEC1" strokeWidth="3" strokeLinecap="round" />
          <path d="M120 65v51" stroke="#E5E9D9" strokeWidth="2" />
          <g transform="rotate(8 160 35)">
            <path d="M142 13h45a9 9 0 0 1 9 9v23a9 9 0 0 1-9 9h-24l-13 10V54h-8a9 9 0 0 1-9-9V22a9 9 0 0 1 9-9Z" fill="#298B7C" />
            <path d="M146 28h36m-36 11h24" stroke="#D7F4E7" strokeWidth="4" strokeLinecap="round" />
          </g>
          <path d="m80 15 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" fill="#8CCEB5" />
        </>
      )}
      {subject === "soft-skills" && (
        <>
          <ellipse cx="124" cy="124" rx="85" ry="9" fill="#E7BBA9" opacity=".4" />
          <circle cx="124" cy="65" r="53" fill="#FBE1D4" />
          <g transform="rotate(-8 95 74)">
            <rect x="53" y="31" width="83" height="88" rx="12" fill="#CE8067" />
            <rect x="50" y="27" width="83" height="88" rx="12" fill="#FFFCF6" />
            <circle cx="91" cy="59" r="18" fill="#F8DFCA" />
            <circle cx="91" cy="55" r="7" fill="#CA8266" />
            <path d="M79 71a12 12 0 0 1 24 0" fill="#CA8266" />
            <path d="M74 89h34m-27 10h20" stroke="#DBBCAB" strokeWidth="3.5" strokeLinecap="round" />
          </g>
          <g transform="rotate(7 163 47)">
            <path d="M137 17h46a11 11 0 0 1 11 11v29a11 11 0 0 1-11 11h-19l-14 12V68h-13a11 11 0 0 1-11-11V28a11 11 0 0 1 11-11Z" fill="#D9866A" />
            <circle cx="143" cy="42" r="3" fill="#FFF4E9" />
            <circle cx="160" cy="42" r="3" fill="#FFF4E9" />
            <circle cx="177" cy="42" r="3" fill="#FFF4E9" />
          </g>
          <circle cx="166" cy="104" r="17" fill="#E8B774" />
          <path d="m158 103 5 5 10-11" stroke="#FFFCF4" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="m42 44 3 7 7 3-7 3-3 7-3-7-7-3 7-3Zm162 36 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#E6B076" />
          <circle cx="85" cy="16" r="3" fill="#D9947B" />
        </>
      )}
    </svg>
  );
}

export function CrtPracticeArt() {
  return (
    <svg className="crt-practice-art" aria-hidden="true" focusable="false" viewBox="0 0 240 140" fill="none">
      <circle cx="143" cy="70" r="59" fill="#385E8B" />
      <circle cx="151" cy="69" r="43" fill="#A6C9E8" />
      <circle cx="151" cy="69" r="31" fill="#315F8D" />
      <circle cx="151" cy="69" r="19" fill="#D8E9F4" />
      <circle cx="151" cy="69" r="7" fill="#E8C268" />
      <path d="m153 67 36-36m-7 4 1-14 12-5-1 14 12-1-5 12-14 1" stroke="#F6D881" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <g transform="rotate(-10 81 77)">
        <rect x="47" y="35" width="67" height="89" rx="10" fill="#173754" />
        <rect x="44" y="31" width="67" height="89" rx="10" fill="#F6F4E8" />
        <rect x="61" y="25" width="33" height="14" rx="5" fill="#E8C268" />
        <path d="m56 57 4 4 7-8m-11 23 4 4 7-8m-11 23 4 4 7-8" stroke="#387C86" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M76 57h20M76 76h20M76 95h15" stroke="#ACC5CA" strokeWidth="3" strokeLinecap="round" />
      </g>
      <path d="M34 28h10m-5-5v10m157 71h12m-6-6v12" stroke="#98BBD8" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="130" cy="124" r="3" fill="#E8C268" />
    </svg>
  );
}
