import { useRef, useState } from "react";
import type { TextInputInstance } from "react-native";
import { ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Button, Field, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pwRef = useRef<TextInputInstance>(null);
  const tooShort = mode === "sign-up" && password.length > 0 && password.length < 10;

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === "sign-in") await auth.signIn(email.trim(), password);
      else await auth.signUp(email.trim(), password);
    } catch (e) {
      if (e instanceof ApiError) setError(e.code === "validation_error" ? "Check your email and use a password of at least 10 characters." : e.message);
      else setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title={mode === "sign-in" ? "Welcome back" : "Create account"} subtitle={mode === "sign-up" ? "Your data stays private to your account." : undefined}>
      <Stack gap={14}>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" returnKeyType="next" onSubmitEditing={() => pwRef.current?.focus()} placeholder="you@example.com" />
        <Field
          ref={pwRef}
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          textContentType={mode === "sign-in" ? "password" : "newPassword"}
          returnKeyType="go"
          onSubmitEditing={submit}
          placeholder={mode === "sign-up" ? "At least 10 characters" : ""}
          error={tooShort ? "Use at least 10 characters" : null}
        />
        {error ? (
          <T variant="footnote" color="danger" accessibilityLiveRegion="polite">
            {error}
          </T>
        ) : null}
        <Button title={mode === "sign-in" ? "Sign in" : "Create account"} onPress={submit} loading={busy} disabled={!email || !password || tooShort} />
      </Stack>
    </Screen>
  );
}
