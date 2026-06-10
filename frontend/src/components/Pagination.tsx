import React from "react";

interface PaginationProps {
  page: number;
  limit: number;
  total: number;
  pages: number;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
}

export default function Pagination({
  page,
  limit,
  total,
  pages,
  onPageChange,
  onLimitChange
}: PaginationProps) {
  if (pages <= 1) return null;

  const renderPageNumbers = () => {
    const pageNumbers = [];
    const maxVisiblePages = 5;
    
    let startPage = Math.max(1, page - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(pages, startPage + maxVisiblePages - 1);
    
    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      pageNumbers.push(
        <button
          key={i}
          onClick={() => onPageChange(i)}
          className={`h-9 w-9 rounded-lg font-bold text-xs transition-all duration-200 cursor-pointer ${
            page === i
              ? "bg-[#3B82F6] text-white shadow-sm"
              : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300"
          }`}
        >
          {i}
        </button>
      );
    }
    return pageNumbers;
  };

  return (
    <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white border border-gray-250 p-4 rounded-xl shadow-none mt-6 animate-slide-in w-full">
      <div className="text-xs font-semibold text-gray-500">
        Hiển thị <span className="font-extrabold text-gray-800">{Math.min(total, (page - 1) * limit + 1)}-{Math.min(total, page * limit)}</span> trong số <span className="font-extrabold text-gray-800">{total}</span> bản ghi
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="h-9 px-3 rounded-lg border border-gray-200 bg-white font-bold text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5 transition-all"
        >
          &larr; Trước
        </button>

        <div className="flex items-center gap-1.5">
          {renderPageNumbers()}
        </div>

        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
          className="h-9 px-3 rounded-lg border border-gray-200 bg-white font-bold text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5 transition-all"
        >
          Sau &rarr;
        </button>
      </div>

      {onLimitChange && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500">Hiển thị</span>
          <select
            value={limit}
            onChange={(e) => onLimitChange(Number(e.target.value))}
            className="h-9 bg-white border border-gray-200 rounded-lg px-2.5 text-xs font-bold text-gray-700 focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            {[5, 10, 20, 50].map((sz) => (
              <option key={sz} value={sz}>
                {sz} / trang
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
