/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AuthActionState } from "@/app/actions/auth";

const signUpAction = vi.fn(async (...args: [AuthActionState, FormData]): Promise<AuthActionState> => { void args; return {}; });
const signInAction = vi.fn(async (...args: [AuthActionState, FormData]): Promise<AuthActionState> => { void args; return {}; });
vi.mock("@/app/actions/auth", () => ({ signUpAction: (...args: [AuthActionState, FormData]) => signUpAction(...args), signInAction: (...args: [AuthActionState, FormData]) => signInAction(...args) }));

const { AuthForm } = await import("./auth-form");

afterEach(() => { cleanup(); signUpAction.mockClear(); signInAction.mockClear(); });

function fill(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("sign up", () => {
  it("says what is wrong with a short password instead of doing nothing", async () => {
    render(<AuthForm mode="sign-up" />);
    fill("Name", "Ada");
    fill("Email", "ada@example.test");
    fill(/Password/, "short");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    // Nothing is sent, and the reason is on the field rather than in a browser
    // bubble that a screen reader never sees.
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("at least 12 characters"));
    expect(signUpAction).not.toHaveBeenCalled();
    const password = screen.getByLabelText(/Password/) as HTMLInputElement;
    expect(password.getAttribute("aria-invalid")).toBe("true");
    expect(password.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    expect(document.activeElement).toBe(password);
  });

  it("submits once the password is long enough", async () => {
    render(<AuthForm mode="sign-up" />);
    fill("Name", "Ada");
    fill("Email", "ada@example.test");
    fill(/Password/, "a-long-enough-password");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(signUpAction).toHaveBeenCalled());
  });

  it("keeps what was typed when the server rejects the attempt", async () => {
    signUpAction.mockResolvedValueOnce({ error: "An account already uses that email address.", values: { displayName: "Ada", email: "ada@example.test" } });
    render(<AuthForm mode="sign-up" />);
    fill("Name", "Ada");
    fill("Email", "ada@example.test");
    fill(/Password/, "a-long-enough-password");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already uses that email"));
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("ada@example.test");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Ada");
  });
});

describe("sign in", () => {
  it("keeps the email and moves focus to the field the server rejected", async () => {
    signInAction.mockResolvedValueOnce({ fieldErrors: { email: ["Enter a valid email address."] }, values: { email: "ada@example" } });
    render(<AuthForm mode="sign-in" />);
    fill("Email", "ada@example");
    fill(/Password/, "whatever-goes-here");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("valid email"));
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect(email.value).toBe("ada@example");
    expect(document.activeElement).toBe(email);
  });
});
