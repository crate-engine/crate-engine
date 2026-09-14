/** One queue consumer per canonical rig/seat, across engine processes.
 * Python is already required by agentctl. flock is kernel-owned on macOS/Linux;
 * never unlink this file (unlinking permits two locks on different inodes).
 */
import { spawn } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
const holder = `import fcntl, os, sys, time
f = open(sys.argv[1], 'a+')
deadline = time.monotonic() + float(sys.argv[2]) / 1000
while True:
    try:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        break
    except BlockingIOError:
        if time.monotonic() >= deadline:
            print('BUSY', flush=True)
            sys.exit(2)
        time.sleep(0.05)
print('LOCKED', flush=True)
sys.stdin.buffer.read()
`;
const live = new WeakSet();
function keyFor(root, seat) {
    if (!/^[a-z][a-z0-9_-]*$/.test(seat))
        throw new Error("Invalid consumer seat");
    const dir = join(realpathSync(root), ".agents", "state", "turns", seat);
    mkdirSync(dir, { recursive: true });
    return join(realpathSync(dir), "consumer.lock");
}
export function assertConsumerLease(lease, root, seat) {
    if (!live.has(lease) || lease.key !== keyFor(root, seat))
        throw new Error("Consumer lease is not held for this seat");
}
export async function acquireConsumerLease(root, seat, waitMs = 0) {
    const key = keyFor(root, seat);
    const child = spawn("python3", ["-c", holder, key, String(waitMs)], { stdio: ["pipe", "pipe", "pipe"] });
    let releasing = false;
    let acquired = false;
    let stderr = "";
    child.stderr.on("data", b => { stderr += String(b); });
    const ended = new Promise(resolve => child.once("close", () => resolve()));
    const lease = {
        key,
        async release() {
            if (releasing)
                return ended;
            releasing = true;
            live.delete(lease);
            child.stdin.end();
            await ended;
        },
    };
    // Losing the lock helper unexpectedly must not leave a functioning consumer
    // behind. A process crash releases the pipe and the kernel lock automatically.
    child.on("exit", () => {
        live.delete(lease);
        if (acquired && !releasing) {
            process.stderr.write(`Consumer lock lost for ${seat}; stopping engine to prevent duplicate work.\n`);
            process.kill(process.pid, "SIGKILL");
        }
    });
    await new Promise((resolve, reject) => {
        let out = "";
        child.once("error", reject);
        child.once("close", () => {
            if (!acquired)
                reject(new Error(`Cannot own ${seat} queue: ${out.trim() === "BUSY" ? "another consumer is running" : stderr.trim() || "lock helper exited"}`));
        });
        child.stdout.on("data", b => {
            out += String(b);
            if (!acquired && out.includes("LOCKED\n")) {
                acquired = true;
                live.add(lease);
                resolve();
            }
        });
    });
    return lease;
}
//# sourceMappingURL=consumer-lease.js.map