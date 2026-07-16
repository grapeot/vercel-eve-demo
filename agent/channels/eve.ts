import { eveChannel } from "eve/channels/eve";

import { authenticateOwnerRequest } from "../../src/security/request";

const ownerAuth = async (request: Request) => {
  const owner = await authenticateOwnerRequest(request);
  if (!owner) return null;
  return {
    authenticator: "owner-challenge",
    principalId: owner.accessSessionId,
    principalType: "user",
    subject: owner.accessSessionId,
    attributes: {},
  };
};

const mockAuth = () => ({
  authenticator: "offline-mock",
  principalId: "offline-mock-owner",
  principalType: "user",
  subject: "offline-mock-owner",
  attributes: {},
});

export default eveChannel({
  auth:
    process.env.EVE_DEMO_MODE === "mock" ? [ownerAuth, mockAuth] : [ownerAuth],
});
