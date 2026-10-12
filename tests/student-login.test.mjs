// Run: TSX_TSCONFIG_PATH=apps/student/tsconfig.json node --import tsx --test tests/student-login.test.mjs
import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><div id='root'></div>", {
  url: "https://student.example.test/login",
});
for (const name of ["window", "document", "navigator", "HTMLElement", "Event"])
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: name === "window" ? dom.window : dom.window[name],
  });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { createElement: h, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, Route, Routes, useLocation, useNavigationType } =
  await import("react-router-dom");
const { QueryClient, QueryClientProvider, focusManager } =
  await import("@tanstack/react-query");
const { StudentLogin } = await import("../apps/student/src/auth.tsx");

const identity = {
  id: "student-test",
  role: "student",
  name: "Test Student",
  email: "student@example.test",
  organizationId: "organization-test",
  organizationName: "Test Organization",
  onboardingStep: null,
  features: [],
};
const originalFetch = globalThis.fetch;
let root;
let client;
let requests;

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function Destination() {
  const location = useLocation();
  const navigation = useNavigationType();
  return h(
    "div",
    {
      "data-destination": location.pathname,
      "data-navigation": navigation,
    },
    "Destination",
  );
}
async function mount(handler, cachedIdentity) {
  requests = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(
      String(url),
      "/api/v1/me?portal=student" +
        (client.getQueryData(["me", "student"]) ? "&passive=1" : ""),
    );
    requests.push({ url: String(url), options });
    return handler();
  };
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  if (cachedIdentity) client.setQueryData(["me", "student"], cachedIdentity);
  root = createRoot(document.getElementById("root"));
  await act(async () => {
    root.render(
      h(
        QueryClientProvider,
        { client },
        h(
          MemoryRouter,
          { initialEntries: ["/login"] },
          h(
            Routes,
            null,
            h(Route, { path: "/login", element: h(StudentLogin) }),
            h(Route, { path: "/", element: h(Destination) }),
            h(Route, { path: "/onboarding", element: h(Destination) }),
          ),
        ),
      ),
    );
  });
}
async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  assert.fail(
    "Expected UI state was not reached: " + document.body.textContent,
  );
}
function destination() {
  return document.querySelector("[data-destination]");
}
function signInForm() {
  return document.querySelector("#student-email");
}
async function type(input, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
    client?.clear();
    focusManager.setFocused(undefined);
  });
  globalThis.fetch = originalFetch;
  root = undefined;
  client = undefined;
});
after(() => dom.window.close());

test("checking an existing session hides the sign-in form", async () => {
  const pending = deferred();
  await mount(() => pending.promise);
  assert.equal(signInForm(), null);
  assert.equal(destination(), null);
  assert.ok(document.querySelector("[role='status']"));
  await act(async () =>
    pending.resolve(response(401, { message: "Sign in to continue." })),
  );
  await waitFor(signInForm);
});

test("an authenticated student goes directly to the dashboard using replace", async () => {
  await mount(() => response(200, identity));
  await waitFor(destination);
  assert.equal(destination().dataset.destination, "/");
  assert.equal(destination().dataset.navigation, "REPLACE");
  assert.equal(signInForm(), null);
});

for (const onboardingStep of ["password", "phone"])
  test(`an authenticated student requiring ${onboardingStep} goes to onboarding`, async () => {
    await mount(() => response(200, { ...identity, onboardingStep }));
    await waitFor(destination);
    assert.equal(destination().dataset.destination, "/onboarding");
    assert.equal(destination().dataset.navigation, "REPLACE");
  });

test("an unauthenticated visitor can sign in", async () => {
  await mount(() => response(401, { message: "Sign in to continue." }));
  await waitFor(signInForm);
  assert.ok(document.querySelector("#student-password"));
  assert.equal(destination(), null);
});

test("a wrong-portal account sees its error and can use another account", async () => {
  const message =
    "This is an organization viewer account. Sign in through the Organization Admin portal.";
  await mount(() => response(403, { message }));
  await waitFor(signInForm);
  assert.ok(document.body.textContent.includes(message));
  assert.equal(destination(), null);
});

test("a connection failure offers retry without pretending the session expired", async () => {
  let fail = true;
  await mount(() => {
    if (fail) throw new TypeError("Test connection failure");
    return response(200, identity);
  });
  await waitFor(() =>
    [...document.querySelectorAll("button")].some((button) =>
      /retry|try again/i.test(button.textContent),
    ),
  );
  assert.equal(signInForm(), null);
  const retry = [...document.querySelectorAll("button")].find((button) =>
    /retry|try again/i.test(button.textContent),
  );
  fail = false;
  await act(async () => retry.click());
  await waitFor(destination);
  assert.equal(destination().dataset.destination, "/");
  assert.equal(requests.length, 2);
});

test("a recently cached identity is revalidated before redirecting", async () => {
  const pending = deferred();
  await mount(() => pending.promise, identity);
  assert.equal(destination(), null);
  assert.equal(signInForm(), null);
  assert.equal(requests.length, 1);
  await act(async () =>
    pending.resolve(response(401, { message: "Your session has expired." })),
  );
  await waitFor(signInForm);
  assert.equal(destination(), null);
  assert.equal(requests.length, 1);
});

test("window-focus session rechecks preserve the visitor's typed credentials", async () => {
  let pending;
  await mount(() =>
    pending
      ? pending.promise
      : response(401, { message: "Sign in to continue." }),
  );
  await waitFor(signInForm);
  await type(signInForm(), "learner@example.test");
  await type(
    document.querySelector("#student-password"),
    "An unsent test password",
  );
  const originalForm = document.querySelector("form");
  pending = deferred();
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(() => requests.length === 2);
  assert.equal(document.querySelector("form"), originalForm);
  assert.equal(signInForm().value, "learner@example.test");
  assert.equal(
    document.querySelector("#student-password").value,
    "An unsent test password",
  );
  await act(async () =>
    pending.resolve(response(401, { message: "Sign in to continue." })),
  );
  await waitFor(() => !client.isFetching());
  assert.equal(document.querySelector("form"), originalForm);
  assert.equal(signInForm().value, "learner@example.test");
  assert.equal(
    document.querySelector("#student-password").value,
    "An unsent test password",
  );
});
