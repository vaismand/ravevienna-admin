import {
  getMissingScriptEnvVars,
  isScriptApiConfigured,
} from "../lib/scriptEnv.js";

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

export const maxDuration = 300;

export default function handler(_req: unknown, res: ApiResponse) {
  res.status(200).json({
    configured: isScriptApiConfigured(),
    activeJob: null,
    missingEnv: getMissingScriptEnvVars(),
  });
}
