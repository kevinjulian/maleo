import { ProductReel } from "./ProductReel";
import type { Product } from "../schema";

export const ProductSquare: React.FC<Product> = (p) => <ProductReel {...p} />;
