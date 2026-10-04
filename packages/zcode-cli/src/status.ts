/** Credential-free account and model state shared by Host and Client. */
import { z } from "zod";
/** Browser-visible state contains authorization URLs while an attempt is active. */
export const PublicStatus = z.object({
  login: z.enum([
    "idle",
    "starting",
    "waiting",
    "signed-in",
    "cancelled",
    "failed",
  ]),
  attemptId: z.string().optional(),
  authorizeUrl: z.string().url().optional(),
  connection: z.enum(["unchecked", "registered", "ready", "failed"]),
  model: z.string(),
  reasoning: z.string(),
  error: z.string().optional(),
  diagnostic: z
    .object({
      code: z.union([z.string(), z.number()]),
      message: z.string(),
    })
    .optional(),
  accountFamily: z.enum(["bigmodel", "zai"]).optional(),
  credentialSource: z.enum(["plugin", "desktop"]).optional(),
});
/** Safe state projected to the local authenticated Web page. */
export type PublicStatus = z.infer<typeof PublicStatus>;
