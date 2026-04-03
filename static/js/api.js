/**
 * THE HUMAN NETWORK — api.js
 * All API fetch calls + data transformations
 * 
 * Exported functions:
 *   - loadGraph()
 *   - loadInsights()
 *   - createEmployee(formData)
 *   - updateEmployee(id, data)
 *   - deleteEmployee(id)
 *   - createRelationship(data)
 *   - updateRelationship(id, data)
 *   - deleteRelationship(id)
 *   - createCompany(data)
 *   - openOrgChart(companyId)
 *   - loadTimeline(empId)
 *   - loadTags()
 */

const HNApi = (() => {
  "use strict";

  /**
   * Load full graph: all nodes, companies, edges
   */
  async function loadGraph() {
    try {
      const data = await HN.api.get("/api/graph");
      return data;
    } catch (e) {
      HN.toast("⚠️  Could not load network.");
      throw e;
    }
  }

  /**
   * Load insights: most connected, isolated, health score, etc.
   */
  async function loadInsights() {
    try {
      return await HN.api.get("/api/insights");
    } catch (e) {
      HN.toast("⚠️  Could not load insights.");
      throw e;
    }
  }

  /**
   * Create new employee
   */
  async function createEmployee(formData) {
    try {
      const res = await fetch("/api/employees", { method: "POST", body: formData });
      if (!res.ok) throw new Error((await res.json()).error || "Error");
      return await res.json();
    } catch (err) {
      throw err;
    }
  }

  /**
   * Update employee
   */
  async function updateEmployee(id, data) {
    try {
      return await HN.api.put(`/api/employees/${id}`, data);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Delete employee
   */
  async function deleteEmployee(id) {
    try {
      return await HN.api.del(`/api/employees/${id}`);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Upload employee profile image
   */
  async function uploadEmployeeImage(empId, file) {
    const fd = new FormData();
    fd.append("profile_image", file);
    try {
      const res = await fetch(`/api/employees/${empId}/image`, { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error || "Error");
      return await res.json();
    } catch (err) {
      throw err;
    }
  }

  /**
   * Create relationship between two employees
   */
  async function createRelationship(data) {
    try {
      return await HN.api.post("/api/relationships", data);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Update relationship
   */
  async function updateRelationship(id, data) {
    try {
      return await HN.api.put(`/api/relationships/${id}`, data);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Delete relationship
   */
  async function deleteRelationship(id) {
    try {
      return await HN.api.del(`/api/relationships/${id}`);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Create company
   */
  async function createCompany(data) {
    try {
      return await HN.api.post("/api/companies", data);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Update company
   */
  async function updateCompany(id, data) {
    try {
      return await HN.api.put(`/api/companies/${id}`, data);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Delete company
   */
  async function deleteCompany(id) {
    try {
      return await HN.api.del(`/api/companies/${id}`);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Load organization chart data for a company
   */
  async function openOrgChart(companyId) {
    try {
      return await HN.api.get(`/api/companies/${companyId}/org`);
    } catch (e) {
      HN.toast("Could not load org chart.");
      throw e;
    }
  }

  /**
   * Load event timeline for an employee
   */
  async function loadTimeline(empId) {
    try {
      return await HN.api.get(`/api/employees/${empId}/events`);
    } catch (e) {
      HN.toast("Could not load timeline.");
      return [];
    }
  }

  /**
   * Add event to employee timeline
   */
  async function addEvent(empId, eventData) {
    try {
      return await HN.api.post(`/api/employees/${empId}/events`, eventData);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Delete event
   */
  async function deleteEvent(eventId) {
    try {
      return await HN.api.del(`/api/events/${eventId}`);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Load all tags in use
   */
  async function loadTags() {
    try {
      return await HN.api.get("/api/tags");
    } catch (e) {
      HN.toast("Could not load tags.");
      return [];
    }
  }

  /**
   * Export to PDS format
   */
  async function exportPDS() {
    try {
      return await HN.api.get("/api/export/pds");
    } catch (err) {
      HN.toast("Could not export PDS.");
      throw err;
    }
  }

  /**
   * Export to PDF
   */
  async function exportPDF() {
    try {
      const res = await fetch("/api/export/pdf");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "people-directory.html";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      HN.toast("Could not export PDF.");
      throw err;
    }
  }

  // ── Public API ──
  return {
    loadGraph,
    loadInsights,
    createEmployee,
    updateEmployee,
    deleteEmployee,
    uploadEmployeeImage,
    createRelationship,
    updateRelationship,
    deleteRelationship,
    createCompany,
    updateCompany,
    deleteCompany,
    openOrgChart,
    loadTimeline,
    addEvent,
    deleteEvent,
    loadTags,
    exportPDS,
    exportPDF,
  };
})();
