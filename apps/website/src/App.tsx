import { LeadForm } from "./components/LeadForm";

function App() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-white shadow-sm py-4">
        <div className="max-w-7xl mx-auto px-4">
          <h1 className="text-3xl font-bold text-gray-900">Contact Us!</h1>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-8">
        <LeadForm />
      </main>
    </div>
  );
}

export default App;
