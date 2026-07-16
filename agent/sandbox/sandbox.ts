import { defineSandbox } from "eve/sandbox";
import { docker } from "eve/sandbox/docker";
import { vercel } from "eve/sandbox/vercel";

const definition = process.env.VERCEL
  ? defineSandbox({ backend: vercel() })
  : defineSandbox({ backend: docker() });

export default definition;
