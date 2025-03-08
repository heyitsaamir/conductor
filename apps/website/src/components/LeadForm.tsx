import { FormEvent, useState } from "react";

const API_URL = "https://gd6fk18t-3000.usw2.devtunnels.ms";

interface LeadData {
  name: string;
  email: string;
  company: string;
  details: string;
  phoneNumber: string;
}

export function LeadForm() {
  const [formData, setFormData] = useState<LeadData>({
    name: "",
    email: "",
    company: "",
    details: "",
    phoneNumber: "",
  });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_URL}/leads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        alert("Thank you for your interest! We'll be in touch soon.");
        setFormData({
          name: "",
          email: "",
          company: "",
          details: "",
          phoneNumber: "",
        });
      } else {
        alert("Failed to submit form");
      }
    } catch (error) {
      alert("Error submitting form");
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-sm">
      <h2 className="text-2xl font-bold mb-2 text-gray-900">Get Started</h2>
      <p className="text-gray-600 mb-6">
        Tell us about your needs and we'll get back to you shortly.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block mb-1 text-gray-700">
            Full Name
          </label>
          <input
            type="text"
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required
          />
        </div>
        <div>
          <label htmlFor="email" className="block mb-1 text-gray-700">
            Business Email
          </label>
          <input
            type="email"
            id="email"
            value={formData.email}
            onChange={(e) =>
              setFormData({ ...formData, email: e.target.value })
            }
            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required
          />
        </div>
        <div>
          <label htmlFor="company" className="block mb-1 text-gray-700">
            Company Name
          </label>
          <input
            type="text"
            id="company"
            value={formData.company}
            onChange={(e) =>
              setFormData({ ...formData, company: e.target.value })
            }
            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required
          />
        </div>
        <div>
          <label htmlFor="phoneNumber" className="block mb-1 text-gray-700">
            Phone Number
          </label>
          <input
            type="tel"
            id="phoneNumber"
            value={formData.phoneNumber}
            onChange={(e) =>
              setFormData({ ...formData, phoneNumber: e.target.value })
            }
            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required
          />
        </div>
        <div>
          <label htmlFor="details" className="block mb-1 text-gray-700">
            How can we help you?
          </label>
          <textarea
            id="details"
            value={formData.details}
            onChange={(e) =>
              setFormData({ ...formData, details: e.target.value })
            }
            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 h-32"
            placeholder="Tell us about your needs and requirements..."
            required
          />
        </div>
        <button
          type="submit"
          className="w-full bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Request More Information
        </button>
      </form>
    </div>
  );
}
