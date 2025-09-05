import { execFile } from "child_process";
import { bufferSizes } from "../config/constants.js";

/**
 * Executes a command with arguments and returns a Promise.
 * @param command The command to execute.
 * @param args The arguments for the command.
 * @returns A Promise that resolves on success or rejects on error.
 */
export function executeCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { maxBuffer: bufferSizes.command },
      (error, _stdout, stderr) => {
        if (error) {
          return reject(
            new Error(
              `Command '${command}' failed: ${error.message}\n${stderr}`
            )
          );
        }
        if (stderr) {
          console.warn(`Command '${command}' output: ${stderr}`);
        }
        resolve();
      }
    );
  });
}
