import { main as jamMain } from "../../plugins/jam/scripts/jam.mjs";

export async function runJam(cwd, args) {
  const oldArgv = process.argv;
  const oldExit = process.exit;
  const oldStdoutWrite = process.stdout.write;
  const oldStderrWrite = process.stderr.write;
  let stdout = "";
  let stderr = "";
  let status = 0;
  const exitSignal = new Error("__jam_test_exit__");
  process.argv = ["node", "jam.mjs", ...args];
  process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
  process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
  process.exit = (code = 0) => { status = Number(code) || 0; throw exitSignal; };
  try {
    await jamMain(args, cwd);
  } catch (err) {
    if (err !== exitSignal && err?.message !== "__jam_test_exit__") {
      status = status || 1;
      stderr += String(err?.message ?? err);
    }
  } finally {
    process.argv = oldArgv;
    process.exit = oldExit;
    process.stdout.write = oldStdoutWrite;
    process.stderr.write = oldStderrWrite;
  }
  return { status, stdout, stderr };
}
