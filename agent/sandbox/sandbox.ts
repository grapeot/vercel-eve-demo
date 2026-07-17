import { defineSandbox } from "eve/sandbox";
import { microsandbox } from "eve/sandbox/microsandbox";
import { vercel } from "eve/sandbox/vercel";

const definition = process.env.VERCEL
  ? defineSandbox({ backend: vercel() })
  : defineSandbox({ backend: microsandbox() });

export default definition;
