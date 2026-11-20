import { getIntegration } from "@/lib/integrations/store";

export type VapiAccount = { accountId: string | null; privateKey: string; publicKey: string };

/** The Vapi account for a workspace. Own mode reads the integration; the pool branch arrives in Part 15. */
export async function resolveVapiAccount(workspaceId: string): Promise<VapiAccount> {
  const integration = await getIntegration("vapi", workspaceId);
  const privateKey = integration?.creds.privateKey;
  if (!privateKey) throw new Error("Vapi is not connected. Add the Vapi private key in settings.");
  return { accountId: null, privateKey, publicKey: integration.config.publicKey ?? "" };
}
