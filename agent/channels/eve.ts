import { eveChannel } from "eve/channels/eve";
import {
  httpBasic,
  localDev,
  placeholderAuth,
  vercelOidc,
} from "eve/channels/auth";

const authMode = process.env.EVE_AUTH_MODE ?? "placeholder";

const browserAuth =
  authMode === "basic" &&
  process.env.EVE_AUTH_USERNAME &&
  process.env.EVE_AUTH_PASSWORD
    ? httpBasic({
        username: process.env.EVE_AUTH_USERNAME,
        password: process.env.EVE_AUTH_PASSWORD,
      })
    : placeholderAuth();

export default eveChannel({
  auth: [vercelOidc(), localDev(), browserAuth],
});
