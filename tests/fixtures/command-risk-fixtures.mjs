const fixtureRows = [
  {
    name: "POSIX git diff",
    shell: "posix",
    riskCode: "unbounded-git-diff",
    risky: "git diff",
    bounded: "git diff --stat",
    expectationByMode: { warn: "warn", block: "block", strict: "block" },
    autoFix: "changed",
  },
  {
    name: "POSIX file read",
    shell: "posix",
    riskCode: "possibly-unbounded-file-read",
    risky: "cat README.md",
    bounded: "cat README.md | head -20",
    expectationByMode: { warn: "warn", block: "block", strict: "block" },
    autoFix: "changed",
  },
  {
    name: "POSIX search",
    shell: "posix",
    riskCode: "search-output-budget",
    risky: "rg TODO src",
    bounded: "rg --max-count 20 TODO src",
    expectationByMode: { warn: "warn", block: "block", strict: "block" },
    autoFix: "changed",
  },
  {
    name: "PowerShell git diff",
    shell: "powershell",
    riskCode: "unbounded-git-diff",
    risky: "powershell -Command \"git diff\"",
    bounded: "powershell -Command \"git diff --stat\"",
    expectationByMode: { warn: "warn", block: "block", strict: "block" },
    autoFix: "unchanged",
  },
  {
    name: "PowerShell file read",
    shell: "powershell",
    riskCode: "possibly-unbounded-file-read",
    risky: "powershell -Command \"Get-Content README.md\"",
    bounded: "powershell -Command \"Get-Content README.md -TotalCount 20\"",
    expectationByMode: { warn: "warn", block: "block", strict: "block" },
    autoFix: "unchanged",
  },
  {
    name: "PowerShell search",
    shell: "powershell",
    riskCode: "search-output-budget",
    risky: "powershell -Command \"Select-String TODO -Path src/*\"",
    bounded: "powershell -Command \"Select-String TODO -Path src/* | Select-Object -First 20\"",
    expectationByMode: { warn: "warn", block: "block", strict: "block" },
    autoFix: "unchanged",
  },
  {
    name: "pwsh git diff",
    shell: "powershell",
    riskCode: "unbounded-git-diff",
    risky: "pwsh -Command \"git diff\"",
    bounded: "pwsh -Command \"git diff --stat\"",
    expectationByMode: { warn: "warn", block: "block", strict: "block" },
    autoFix: "unchanged",
  },
  {
    name: "cmd.exe git diff",
    shell: "cmd",
    riskCode: "unbounded-git-diff",
    risky: "cmd.exe /c git diff",
    bounded: "cmd.exe /c git diff --stat",
    expectationByMode: { warn: "warn", block: "block", strict: "block" },
    autoFix: "unchanged",
  },
  {
    name: "cmd.exe file read",
    shell: "cmd",
    riskCode: "possibly-unbounded-file-read",
    risky: "cmd.exe /c type README.md",
    bounded: "cmd.exe /c type README.md | powershell -Command \"$input | Select-Object -First 20\"",
    expectationByMode: { warn: "warn", block: "block", strict: "block" },
    autoFix: "unchanged",
  },
  {
    name: "cmd.exe search",
    shell: "cmd",
    riskCode: "search-output-budget",
    risky: "cmd.exe /c findstr TODO README.md",
    bounded: "cmd.exe /c findstr TODO README.md | powershell -Command \"$input | Select-Object -First 20\"",
    expectationByMode: { warn: "warn", block: "block", strict: "block" },
    autoFix: "unchanged",
  },
];

const classificationByMode = {
  warn: { risky: "true-positive warning", bounded: "true-negative", falsePositive: false, falseNegative: false },
  block: { risky: "true-positive block", bounded: "true-negative", falsePositive: false, falseNegative: false },
  strict: { risky: "true-positive block", bounded: "true-negative", falsePositive: false, falseNegative: false },
};

export const riskFixtures = fixtureRows.map((fixture) => ({ ...fixture, classificationByMode }));

export const quoteAwareSafeFixtures = [
  { name: "quoted POSIX command literal", command: "printf '%s\\n' 'git diff'" },
  { name: "escaped POSIX metacharacters", command: "printf '%s\\n' git\\ diff \\| head" },
  { name: "POSIX comment text", command: "printf safe # git diff" },
  { name: "quoted PowerShell script text", command: "pwsh -Command \"Write-Output 'git diff'\"" },
  { name: "quoted cmd script text", command: "cmd.exe /c echo \"git diff\"" },
  { name: "quoted bounded-read text", command: "printf '%s' 'cat README.md | head -20'" },
  { name: "quoted heredoc text", command: "printf '%s' '<<A <<B <<C <<D'" },
];

export const quoteAwareRiskFixtures = [
  { name: "operator executable position", command: "printf done; git diff", riskCode: "unbounded-git-diff" },
  { name: "comment cannot add a bound", command: "git diff # | head -20", riskCode: "unbounded-git-diff" },
  { name: "quoted option text cannot add a bound", command: "git diff --format='--stat'", riskCode: "unbounded-git-diff" },
  { name: "PowerShell wrapper executable position", command: "pwsh -Command \"Write-Output done; git diff\"", riskCode: "unbounded-git-diff" },
  { name: "cmd wrapper executable position", command: "cmd.exe /c \"echo done & git diff\"", riskCode: "unbounded-git-diff" },
];

export const malformedConservativeFixtures = [
  { name: "unterminated POSIX quote", command: "printf 'git diff", riskCode: "unbounded-git-diff" },
  { name: "unterminated PowerShell wrapper quote", command: "pwsh -Command \"Write-Output 'git diff'", riskCode: "unbounded-git-diff" },
  { name: "dangling escape", command: "echo safe && rg TODO \\", riskCode: "search-output-budget" },
];

export const unsupportedCompositionFixtures = [
  { name: "pipeline", command: "rg TODO src | sort" },
  { name: "redirection", command: "grep TODO README.md > matches.txt" },
  { name: "subshell", command: "$(git diff)" },
  { name: "and-chain", command: "cat README.md && echo done" },
  { name: "semicolon-chain", command: "git diff; echo done" },
  { name: "PowerShell", command: "powershell -Command \"Get-Content README.md\"" },
  { name: "cmd.exe", command: "cmd.exe /c type README.md" },
];
