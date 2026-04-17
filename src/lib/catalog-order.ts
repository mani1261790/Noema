type NotebookWithSource = {
  order: number;
  source?: {
    kind?: string;
    originalUrl?: string;
  };
};

type ParsedSourceLocation = {
  folder: string;
  fileStem: string;
};

function parseSourceLocation(originalUrl: string): ParsedSourceLocation | null {
  const match = String(originalUrl || "").match(/\/tutorials\/([^/]+)\/student\/([^/.]+)\.ipynb$/i);
  if (match) {
    return {
      folder: match[1],
      fileStem: match[2]
    };
  }

  const rootMatch = String(originalUrl || "").match(/\/tutorials\/student\/([^/.]+)\.ipynb$/i);
  if (rootMatch) {
    return {
      folder: "student",
      fileStem: rootMatch[1]
    };
  }

  return null;
}

function folderSortKey(folder: string): [number, number, number, string] {
  const normalized = String(folder || "").trim();
  if (normalized === "student") return [0, 0, 0, normalized];

  const weekDayMatch = normalized.match(/^W(\d+)D(\d+)_/i);
  if (weekDayMatch) {
    return [1, Number(weekDayMatch[1]), Number(weekDayMatch[2]), normalized];
  }

  if (/^Module_WrapUps$/i.test(normalized)) return [2, 0, 0, normalized];
  if (/^Bonus_/i.test(normalized)) return [3, 0, 0, normalized];
  return [4, 0, 0, normalized];
}

function fileSortRank(fileStem: string): number {
  const normalized = String(fileStem || "").trim();
  const lower = normalized.toLowerCase();

  if (lower === "intro" || /_intro$/i.test(normalized)) return 0;
  if (lower === "intro_vid") return 1;

  const tutorialMatch = normalized.match(/tutorial(\d+)/i);
  if (tutorialMatch) return 10 + Number(tutorialMatch[1]);

  if (/bonuslecture/i.test(normalized)) return 80;
  if (lower === "outro" || /_outro$/i.test(normalized)) return 90;
  if (lower === "outro_vid") return 91;
  if (/daysummary/i.test(normalized)) return 99;
  return 50;
}

function compareSourceLocation(a: ParsedSourceLocation, b: ParsedSourceLocation): number {
  const folderA = folderSortKey(a.folder);
  const folderB = folderSortKey(b.folder);

  for (let index = 0; index < folderA.length; index += 1) {
    if (folderA[index] < folderB[index]) return -1;
    if (folderA[index] > folderB[index]) return 1;
  }

  const fileRankA = fileSortRank(a.fileStem);
  const fileRankB = fileSortRank(b.fileStem);
  if (fileRankA !== fileRankB) return fileRankA - fileRankB;

  return a.fileStem.localeCompare(b.fileStem);
}

export function compareNotebookOrder<T extends NotebookWithSource>(a: T, b: T): number {
  const aExternal = a.source?.kind === "open-license-translation";
  const bExternal = b.source?.kind === "open-license-translation";

  if (aExternal && bExternal) {
    const sourceA = parseSourceLocation(a.source?.originalUrl || "");
    const sourceB = parseSourceLocation(b.source?.originalUrl || "");

    if (sourceA && sourceB) {
      const bySource = compareSourceLocation(sourceA, sourceB);
      if (bySource !== 0) return bySource;
    }
  }

  return a.order - b.order;
}
