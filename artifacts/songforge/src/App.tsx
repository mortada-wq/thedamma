import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import { Home } from "@/pages/home";
import { SongDetail } from "@/pages/song-detail";
import { RagGrid } from "@/pages/rag-grid";
import { Admin } from "@/pages/admin";
import { Login } from "@/pages/login";
import { Register } from "@/pages/register";
import { Pending } from "@/pages/pending";
import { Projects } from "@/pages/projects";
import { ProjectDetail } from "@/pages/project-detail";
import { Groups } from "@/pages/groups";
import { GroupDetail } from "@/pages/group-detail";
import { AuthProvider, useAuth } from "@/context/auth";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const auth = useAuth();
  if (auth.status === "loading") return null;
  if (auth.status === "unauthenticated") return <Redirect to="/login" />;
  if (auth.status === "authenticated" && auth.user.role === "pending") return <Pending />;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/projects/:id">
        {(params) => (
          <Layout>
            <ProtectedRoute component={() => <ProjectDetail />} />
          </Layout>
        )}
      </Route>
      <Route path="/projects">
        <Layout>
          <ProtectedRoute component={Projects} />
        </Layout>
      </Route>
      <Route path="/groups/:id">
        {() => (
          <Layout>
            <ProtectedRoute component={GroupDetail} />
          </Layout>
        )}
      </Route>
      <Route path="/groups">
        <Layout>
          <ProtectedRoute component={Groups} />
        </Layout>
      </Route>
      <Route path="/">
        <Layout><Home /></Layout>
      </Route>
      <Route path="/song/:id">
        <Layout><SongDetail /></Layout>
      </Route>
      <Route path="/rag-grid">
        <Layout><RagGrid /></Layout>
      </Route>
      <Route path="/admin">
        <Layout><Admin /></Layout>
      </Route>
      <Route>
        <Layout><NotFound /></Layout>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
