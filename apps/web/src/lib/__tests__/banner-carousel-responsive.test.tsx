// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BannerCarousel } from "@/components/loja/BannerCarousel";

const banners = [
  { id: "banner-a", title: "Dois looks", imageUrl: "/uploads/banner-a.jpg", linkUrl: "/produtos" },
  { id: "banner-b", title: "Promoção", imageUrl: "/uploads/banner-b.jpg" },
];

afterEach(cleanup);

describe("BannerCarousel — imagens integrais no mobile", () => {
  it("exibe imagem inteira no mobile e preserva layout desktop", () => {
    render(<BannerCarousel banners={banners} />);
    const image = screen.getByRole("img", { name: "Dois looks" });
    expect(image).toHaveClass("object-contain", "sm:object-cover");
    expect(image).toHaveClass("h-full", "w-full");
    expect(image.parentElement).toHaveClass("aspect-video", "sm:aspect-[16/6]");
    expect(image.parentElement).not.toHaveClass("aspect-[5/4]");
  });

  it("mantém enquadramento ao navegar entre banners", () => {
    render(<BannerCarousel banners={banners} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Próximo banner" })[0]);
    const image = screen.getByRole("img", { name: "Promoção" });
    expect(image).toHaveClass("object-contain", "sm:object-cover");
    expect(screen.getByRole("button", { name: "Ir para o banner 2" })).toHaveAttribute("aria-current", "true");
  });

  it("não mostra navegação quando existe apenas um banner", () => {
    render(<BannerCarousel banners={[banners[0]]} />);
    expect(screen.getByRole("img", { name: "Dois looks" })).toHaveClass("object-contain");
    expect(screen.queryByRole("button", { name: "Próximo banner" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Dois looks/ })).toHaveAttribute("href", "/produtos");
  });
});
