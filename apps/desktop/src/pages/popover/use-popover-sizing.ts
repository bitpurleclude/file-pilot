import { useEffect, useRef, type RefObject } from "react";

/**
 * Keeps the frameless popover sized to its natural content. The body is a flex
 * viewport, so its scrollHeight always equals the window; measuring an inner
 * content wrapper is what makes the window shrink below its initial height.
 */
export const usePopoverSizing = (): {
  cardRef: RefObject<HTMLDivElement>;
  contentRef: RefObject<HTMLDivElement>;
} => {
  const cardRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastHeightRef = useRef<number>(0);

  useEffect(() => {
    const card = cardRef.current;
    const content = contentRef.current;
    if (card === null || content === null) {
      return;
    }

    let frame = 0;
    const measure = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const header = card.querySelector<HTMLElement>(".popover-header");
        if (header === null) {
          return;
        }
        const height = Math.max(280, Math.ceil(header.getBoundingClientRect().height + content.scrollHeight + 30));
        if (height === lastHeightRef.current) {
          return;
        }
        lastHeightRef.current = height;
        void window.filePilotApi?.resizePopover({ height });
      });
    };

    const observer = new ResizeObserver(measure);
    observer.observe(content);
    measure();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return { cardRef, contentRef };
};
