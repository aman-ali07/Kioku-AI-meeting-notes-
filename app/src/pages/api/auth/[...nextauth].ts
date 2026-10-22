import NextAuth from "next-auth";
import { authOptions } from "@/auth";

// next-auth v4 hosts its catch-all handler via the Pages API (next-auth v5 is
// still beta). The App Router in src/app/ and this route coexist fine.
export default NextAuth(authOptions);
