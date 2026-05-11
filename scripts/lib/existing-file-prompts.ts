import type { ExistingRawXmlFileDecision, ExistingRawXmlFilePrompt } from "../../src/lib/pointstreak-archive";

type Questioner = {
  question(prompt: string): Promise<string>;
};

function parseExistingFileDecision(value: string): ExistingRawXmlFileDecision | null {
  const normalized = value.trim().toLowerCase();

  if (normalized === "" || normalized === "s" || normalized === "skip") {
    return "skip";
  }
  if (normalized === "o" || normalized === "overwrite") {
    return "overwrite";
  }
  if (
    normalized === "a" ||
    normalized === "oa" ||
    normalized === "overwrite all" ||
    normalized === "overwrite always" ||
    normalized === "always overwrite"
  ) {
    return "overwriteAlways";
  }
  if (
    normalized === "l" ||
    normalized === "sa" ||
    normalized === "skip all" ||
    normalized === "skip always" ||
    normalized === "always skip"
  ) {
    return "skipAlways";
  }

  return null;
}

export function createExistingRawXmlFilePrompt(questioner: Questioner): ExistingRawXmlFilePrompt {
  let alwaysDecision: ExistingRawXmlFileDecision | null = null;

  return async ({ label, outPath }) => {
    if (alwaysDecision) {
      return alwaysDecision;
    }

    console.log("");
    console.log(`Existing XML file found for ${label}:`);
    console.log(outPath);

    while (true) {
      const answer = await questioner.question(
        "Choose [o]verwrite, overwrite [a]lways, [s]kip, or skip a[l]l. Default: skip > ",
      );
      const decision = parseExistingFileDecision(answer);
      if (!decision) {
        console.log("Please enter overwrite, overwrite always, skip, or skip always.");
        continue;
      }

      if (decision === "overwriteAlways" || decision === "skipAlways") {
        alwaysDecision = decision;
      }

      return decision;
    }
  };
}
