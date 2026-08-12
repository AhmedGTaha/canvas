import { z } from "zod";

const email = z.string().trim().max(254, "Email is too long.").email("Enter a valid email address.");
const password = z.string().min(12, "Use at least 12 characters.").max(128, "Password is too long.");

export const signUpSchema = z.object({
  displayName: z.string().trim().min(1, "Enter your name.").max(120, "Name must be 120 characters or fewer."),
  email,
  password,
});

export const signInSchema = z.object({ email, password: z.string().min(1, "Enter your password.").max(128) });

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
