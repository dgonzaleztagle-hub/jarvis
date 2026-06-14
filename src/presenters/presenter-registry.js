class PresenterRegistry {
  constructor() {
    this.presenters = new Map();
  }

  register(toolName, presenter) {
    this.presenters.set(toolName, presenter);
  }

  canPresent(toolResults = []) {
    return toolResults.some((item) => this.presenters.has(item.toolName));
  }

  present(toolResults = []) {
    const waiting = toolResults.find((item) => item.status === 'waiting_confirmation');
    if (waiting) {
      return {
        speak: 'Necesito tu confirmación antes de continuar.',
        visual: `La acción ${waiting.toolName} requiere confirmación.`
      };
    }

    const failed = toolResults.find((item) => item.status === 'failed' || item.error);
    if (failed) {
      return {
        speak: 'La tarea no se pudo completar correctamente.',
        visual: `Falló ${failed.toolName}: ${failed.error?.message || 'error desconocido'}`
      };
    }

    const presented = toolResults
      .filter((item) => this.presenters.has(item.toolName))
      .map((item) => this.presenters.get(item.toolName)(item));

    if (presented.length === 0) {
      return {
        speak: 'Tarea completada.',
        visual: ''
      };
    }

    return {
      speak: presented.map((item) => item.speak).filter(Boolean).join(' '),
      format: presented.find((item) => item.format)?.format,
      visual: presented.map((item) => item.visual).filter(Boolean).join('\n\n')
    };
  }
}

module.exports = {
  PresenterRegistry
};
